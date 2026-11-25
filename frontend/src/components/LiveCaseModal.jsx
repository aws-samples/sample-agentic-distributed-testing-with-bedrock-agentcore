import { useState, useMemo } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import TcEvidencePanel from './TcEvidencePanel'
import styles from './LiveCaseModal.module.css'

// Live view of one feature on the Runner: the same panel Analysis uses for a finished
// case (verdict, log), updating as the agent works, plus Pause / Resume and
// "redo these cases with a hint". The redo itself is a new run (see POST /api/tests/redo).
export default function LiveCaseModal({ feature, testCases, testResults, tcLogs, sessionStatus, running, pauseState, onTogglePause, onRedo, onClose }) {
  const tcs = testCases || []
  const runningTc = tcs.find(tc => testResults[tc.id]?.status === 'RUNNING')
  const [picked, setPicked] = useState(null)
  const [checked, setChecked] = useState(() => new Set())
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Follow the running case unless the person picked another one.
  const shownId = picked || runningTc?.id || tcs.find(tc => testResults[tc.id]?.status === 'FAIL')?.id || tcs[0]?.id
  const shown = tcs.find(tc => tc.id === shownId)
  const result = (shown && testResults[shown.id]) || {}
  const panelTc = useMemo(() => shown && ({
    id: shown.id,
    title: shown.title,
    status: result.status || 'PENDING',
    reason: result.reason,
    logs: tcLogs[shown.id] || [],
    snapshots: [],
  }), [shown, result.status, result.reason, tcLogs])

  const failed = tcs.filter(tc => testResults[tc.id]?.status === 'FAIL')
  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const ids = [...checked].filter(id => tcs.some(tc => tc.id === id))
  const canRedo = !running && ids.length > 0 && hint.trim() && !busy

  const submit = async () => {
    setBusy(true); setError('')
    try {
      await onRedo(ids, hint.trim())
      setHint(''); setChecked(new Set())
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} width={1000} title={`${feature} — live test case`}>
      <div className={styles.wrap}>
        <div className={styles.toolbar}>
          <select className={styles.select} aria-label="Test case to show" value={shownId || ''} onChange={(e) => setPicked(e.target.value || null)}>
            {tcs.map(tc => <option key={tc.id} value={tc.id}>{tc.id} · {testResults[tc.id]?.status || 'PENDING'} · {tc.title}</option>)}
          </select>
          {running && (
            <Btn size="sm" onClick={onTogglePause}
              title={pauseState ? 'Continue with the next test case' : 'Hold this feature before its next test case; other features keep running'}>
              <Icon name={pauseState ? 'play_arrow' : 'pause'} />{pauseState === 'paused' ? 'Resume' : pauseState ? 'Pausing… (cancel)' : 'Pause'}
            </Btn>
          )}
        </div>
        {pauseState === 'pausing' && <div className={styles.note} role="status">Waiting for the running test case to finish; it cannot be interrupted inside the agent.</div>}

        <div className={styles.panel}><TcEvidencePanel tc={panelTc} liveScreenshot={sessionStatus?.screenshot} /></div>

        <div className={styles.redo}>
          <div className={styles.redoTitle}>Redo with a hint</div>
          {failed.length === 0 && <div className={styles.note}>No failed test cases in this feature yet.</div>}
          <div className={styles.checks}>
            {failed.map(tc => (
              <label key={tc.id} className={styles.check}>
                <input type="checkbox" aria-label={`Redo ${tc.id}`} checked={checked.has(tc.id)} onChange={() => toggle(tc.id)} />
                <span>{tc.id} · {tc.title}</span>
              </label>
            ))}
          </div>
          <textarea className={styles.hint} aria-label="Hint for the agent" rows={2} maxLength={1000} value={hint} onChange={(e) => setHint(e.target.value)}
            placeholder="Tell the agent what it got wrong, e.g. “The Transfer button is under the Accounts menu”" />
          <div className={styles.redoRow}>
            <Btn variant="primary" disabled={!canRedo} onClick={submit}
              title={running ? 'Available once this feature has finished (Stop the run to end it after the current case)' : ''}>
              <Icon name="replay" />Redo {ids.length || ''} with hint
            </Btn>
            {running && <span className={styles.note}>The feature is still running. Redo is available once it has finished.</span>}
            {error && <span className={styles.err} role="alert">{error}</span>}
          </div>
          <div className={styles.note}>The hint is passed to the agent as information, and is saved in run history. The earlier result is kept.</div>
        </div>
      </div>
    </Modal>
  )
}
