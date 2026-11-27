import { useState } from 'react'
import styles from './FocusModal.module.css'
import FeaturePanel from './FeaturePanel'
import TcEvidencePanel from './TcEvidencePanel'
import TcFrame from './TcFrame'
import Btn from './Btn'
import Icon from './Icon'
import { useStickToBottom } from '../hooks/useStickToBottom'
import { pauseLabel } from '../utils/pauseText.mjs'
import { useNow } from '../utils/useNow'

// One place per feature: browser screenshot, feature-level agent log, and the case list where each
// case expands to its live frame, verdict and own log. Pause / Resume sit in the header. Failed cases
// can be redone with a hint from the bottom of the list: the redo joins the feature's queue and runs
// right after the case in progress (see POST /api/tests/redo); a queued redo can be cancelled.
export default function FocusModal({ featureName, testCases, testResults, sessionStatus, sessionLogs, tcLogs = {}, running, pauseState, queuedRedos = {}, onTogglePause, onRedo, onCancelRedo, onClose, onClearLog }) {
  const [checked, setChecked] = useState(() => new Set())
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pauseMsg, setPauseMsg] = useState('')
  const now = useNow(!!pauseState)

  if (!featureName) return null

  const sess = sessionStatus || {}
  const tcs = testCases || []
  const logs = sessionLogs || []

  const statusOf = (id) => testResults[id]?.status || 'PENDING'
  const queuedOf = (id) => (queuedRedos[id]?.feature === featureName ? queuedRedos[id] : null)
  const failed = tcs.filter(tc => statusOf(tc.id) === 'FAIL')
  const ids = failed.filter(tc => checked.has(tc.id) && !queuedOf(tc.id)).map(tc => tc.id)
  const runningIds = tcs.filter(tc => statusOf(tc.id) === 'RUNNING').map(tc => tc.id)
  const canRedo = ids.length > 0 && hint.trim() && !busy
  const paused = pauseState?.state === 'paused'

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

  const togglePause = async () => setPauseMsg((await onTogglePause()) || '')

  // Shown only when the feature has a failed case, and the hint box only once a case is ticked.
  const redoForm = failed.length > 0 && (
    <div className={styles.redo}>
      {ids.length === 0 ? (
        <div className={styles.note}>Tick failed cases to redo them with a hint. A redo runs right after the case in progress.</div>
      ) : (
        <>
          <textarea className={styles.hint} aria-label="Hint for the agent" rows={2} maxLength={1000} value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Tell the agent what it got wrong, e.g. “The Transfer button is under the Accounts menu”" />
          <div className={styles.redoRow}>
            <Btn variant="primary" size="sm" disabled={!canRedo} onClick={submit}>
              <Icon name="replay" />Redo {ids.length} with hint
            </Btn>
            {running && <span className={styles.note}>{paused ? 'Runs now; the feature stays paused afterwards.' : 'Queued: runs right after the case in progress, then the feature carries on.'}</span>}
            {error && <span className={styles.err} role="alert">{error}</span>}
          </div>
          <div className={styles.note}>The hint is passed to the agent as information and saved in run history. The earlier result is kept.</div>
        </>
      )}
    </div>
  )

  // Auto-scroll log to bottom — pauses when the user scrolls up to read history
  const { ref: logBodyRef, atBottom, newSinceScroll, scrollToBottom } = useStickToBottom([logs])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{featureName}</span>
          {pauseState && <span className={styles.pauseStatus} role="status">{pauseLabel(pauseState, now)}</span>}
          {running && (
            <Btn size="sm" onClick={togglePause}
              title={pauseState ? (paused ? 'Continue with the next test case' : 'Cancel the pause') : 'Hold this feature before its next test case; the case in progress finishes first and other features keep running'}>
              <Icon name={pauseState ? 'play_arrow' : 'pause'} />{paused ? 'Resume' : pauseState ? 'Cancel pause' : 'Pause'}
            </Btn>
          )}
          <button className="btn btn-sm" onClick={onClose}><Icon name="close" />Close</button>
        </div>
        {pauseState && !paused && (
          <div className={styles.pauseNote} role="status">The case in progress cannot be interrupted inside the agent, so the feature holds when it finishes.</div>
        )}
        {pauseMsg && <div className={styles.pauseNote} role="alert">{pauseMsg}</div>}

        <div className={styles.content}>
          {/* Left: TC list + detail — same FeaturePanel as runner, single feature always expanded */}
          <FeaturePanel
            style={{ width: 'var(--focus-list-w)', borderRight: '1px solid var(--border)' }}
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
              <input type="checkbox" aria-label={`Redo ${tc.id}`} disabled={!!queuedOf(tc.id)} checked={checked.has(tc.id) && !queuedOf(tc.id)} onChange={() => toggle(tc.id)} />
            )}
            renderTcTail={(tc) => queuedOf(tc.id) && (
              <>
                <span className={styles.queuedTag} title={`Hint: ${queuedOf(tc.id).hint}`}>Queued: redo with hint</span>
                <button type="button" className={styles.queuedCancel} aria-label={`Cancel queued redo of ${tc.id}`} title="Cancel this redo before it starts"
                  onClick={() => onCancelRedo(tc.id, queuedOf(tc.id).runId)}><Icon name="close" size={12} /></button>
              </>
            )}
            renderTcLive={(tc, status) => (
              <>
                <TcFrame tcId={tc.id} status={status} liveScreenshot={sess.screenshot} />
                <div className={styles.liveEvidence}>
                  <TcEvidencePanel compact tc={{
                    id: tc.id, title: tc.title, status,
                    reason: testResults[tc.id]?.reason, logs: tcLogs[tc.id] || [],
                  }} />
                </div>
              </>
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
