import { useState } from 'react'
import styles from './FocusModal.module.css'
import FeaturePanel from './FeaturePanel'
import TcEvidencePanel from './TcEvidencePanel'
import Btn from './Btn'
import Icon from './Icon'
import { useStickToBottom } from '../hooks/useStickToBottom'

// One place per feature: browser screenshot, feature-level agent log, and the case list where each
// case expands to its live verdict and own log. Pause / Resume sit in the header; failed cases
// can be redone with a hint (a new run, see POST /api/tests/redo) from the bottom of the list.
export default function FocusModal({ featureName, testCases, testResults, sessionStatus, sessionLogs, tcLogs = {}, running, pauseState, onTogglePause, onRedo, onClose, onClearLog }) {
  const [checked, setChecked] = useState(() => new Set())
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!featureName) return null

  const sess = sessionStatus || {}
  const tcs = testCases || []
  const logs = sessionLogs || []

  const statusOf = (id) => testResults[id]?.status || 'PENDING'
  const failed = tcs.filter(tc => statusOf(tc.id) === 'FAIL')
  const ids = failed.filter(tc => checked.has(tc.id)).map(tc => tc.id)
  const runningIds = tcs.filter(tc => statusOf(tc.id) === 'RUNNING').map(tc => tc.id)
  // A running feature takes a redo only while it is held (paused); it runs before the feature resumes.
  const canRedo = (!running || pauseState === 'paused') && ids.length > 0 && hint.trim() && !busy

  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

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

  const redoForm = failed.length > 0 && (
    <div className={styles.redo}>
      <div className={styles.redoTitle}>Redo failed cases with a hint</div>
      <textarea className={styles.hint} aria-label="Hint for the agent" rows={2} maxLength={1000} value={hint}
        onChange={(e) => setHint(e.target.value)}
        placeholder="Tick the failed cases above, then tell the agent what it got wrong, e.g. “The Transfer button is under the Accounts menu”" />
      <div className={styles.redoRow}>
        <Btn variant="primary" size="sm" disabled={!canRedo} onClick={submit}
          title={canRedo || !running ? '' : 'Pause this feature, or wait until it has finished (Stop the run to end it after the current case)'}>
          <Icon name="replay" />Redo {ids.length || ''} with hint
        </Btn>
        {running && pauseState !== 'paused' && <span className={styles.note}>The feature is still running. Pause it to redo now, or wait until it has finished.</span>}
        {running && pauseState === 'paused' && <span className={styles.note}>The redo runs now; the feature stays paused afterwards.</span>}
        {error && <span className={styles.err} role="alert">{error}</span>}
      </div>
      <div className={styles.note}>The hint is passed to the agent as information and saved in run history. The earlier result is kept.</div>
    </div>
  )

  // Auto-scroll log to bottom — pauses when the user scrolls up to read history
  const { ref: logBodyRef, atBottom, newSinceScroll, scrollToBottom } = useStickToBottom([logs])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{featureName}</span>
          {running && (
            <Btn size="sm" onClick={onTogglePause}
              title={pauseState ? 'Continue with the next test case' : 'Hold this feature before its next test case; other features keep running'}>
              <Icon name={pauseState ? 'play_arrow' : 'pause'} />{pauseState === 'paused' ? 'Resume' : pauseState ? 'Pausing… (cancel)' : 'Pause'}
            </Btn>
          )}
          <button className="btn btn-sm" onClick={onClose}><Icon name="close" />Close</button>
        </div>
        {pauseState === 'pausing' && (
          <div className={styles.pauseNote} role="status">Pausing… waiting for the running test case to finish; it cannot be interrupted inside the agent.</div>
        )}

        <div className={styles.content}>
          {/* Left: TC list + detail — same FeaturePanel as runner, single feature always expanded */}
          <FeaturePanel
            style={{ width: 440, borderRight: '1px solid var(--border)' }}
            features={[featureName]}
            testCases={{ [featureName]: tcs }}
            testResults={testResults}
            sessionStatus={sessionStatus}
            expandedFeature={featureName}
            onFeatureClick={() => {}}
            showSessionIndicators={true}
            showStatusBadges={true}
            showTcDetail={true}
            autoExpandTcIds={runningIds}
            renderTcLead={(tc, status) => status === 'FAIL' && (
              <input type="checkbox" aria-label={`Redo ${tc.id}`} checked={checked.has(tc.id)} onChange={() => toggle(tc.id)} />
            )}
            renderTcLive={(tc, status) => (
              <TcEvidencePanel tc={{
                id: tc.id, title: tc.title, status,
                reason: testResults[tc.id]?.reason, logs: tcLogs[tc.id] || [],
              }} />
            )}
            footer={redoForm || undefined}
          />

          {/* Centre: screenshot */}
          <div className={styles.screenshotArea}>
            {sess.screenshot ? (
              <img src={`data:image/jpeg;base64,${sess.screenshot}`} alt="Browser" />
            ) : (
              <div className={styles.noScreenshot}>No screenshot yet</div>
            )}
          </div>

          {/* Right: terminal agent log */}
          <div className={styles.logPanel}>
            <div className={styles.logHeader}>
              <span className={styles.logHeaderLabel}>
                <Icon name="bolt" />
                Agent Log
              </span>
              <button className={styles.clearBtn} onClick={onClearLog}>Clear</button>
            </div>
            <div className={styles.logBodyWrap}>
              <div className={styles.logBody} ref={logBodyRef}>
                {logs.map((entry, i) => {
                  const cls = entry.kind || entry.type || 'info'
                  return (
                    <div key={i} className={`${styles.logEntry} ${styles['logEntry_' + cls] || styles.logEntry_info}`}>
                      <span className={styles.logTs}>{entry.ts}</span>
                      {entry.msg}
                    </div>
                  )
                })}
              </div>
              {!atBottom && newSinceScroll > 0 && (
                <button className={styles.resumePill} onClick={scrollToBottom}>
                  <Icon name="arrow_downward" />
                  {newSinceScroll} new {newSinceScroll === 1 ? 'entry' : 'entries'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
