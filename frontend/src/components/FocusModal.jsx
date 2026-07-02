import styles from './FocusModal.module.css'
import ModulePanel from './ModulePanel'
import Icon from './Icon'
import { useStickToBottom } from '../hooks/useStickToBottom'

export default function FocusModal({ moduleName, testCases, testResults, sessionStatus, sessionLogs, onClose, onClearLog }) {
  if (!moduleName) return null

  const sess = sessionStatus || {}
  const tcs = testCases || []
  const logs = sessionLogs || []

  // Auto-scroll log to bottom — pauses when the user scrolls up to read history
  const { ref: logBodyRef, atBottom, newSinceScroll, scrollToBottom } = useStickToBottom([logs])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{moduleName}</span>
          <button className="btn btn-sm" onClick={onClose}><Icon name="close" />Close</button>
        </div>

        <div className={styles.content}>
          {/* Left: TC list + detail — same ModulePanel as runner, single module always expanded */}
          <ModulePanel
            style={{ width: 320, borderRight: '1px solid var(--border)' }}
            modules={[moduleName]}
            testCases={{ [moduleName]: tcs }}
            testResults={testResults}
            sessionStatus={sessionStatus}
            expandedModule={moduleName}
            onModuleClick={() => {}}
            showSessionIndicators={true}
            showStatusBadges={true}
            showTcDetail={true}
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
