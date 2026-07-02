import styles from './BrowserCell.module.css'
import { moduleColor } from '../data/seedTestCases'

export default function BrowserCell({ moduleName, sessionStatus, activeModules, onFocus }) {
  const sess = sessionStatus || {}
  const isRunning = activeModules?.has(moduleName)
  const color = moduleColor(moduleName)

  let connClass = styles.conn + ' ' + styles.connDisconnected
  if (isRunning) connClass = styles.conn + ' ' + styles.connRunning
  else if (sess.connecting) connClass = styles.conn + ' ' + styles.connConnecting
  else if (sess.connected) connClass = styles.conn + ' ' + styles.connConnected

  return (
    <div className={`${styles.cell}${isRunning ? ' ' + styles.activeModule : ''}`}>
      <div className={styles.header} onClick={onFocus}>
        <div className={connClass} />
        <span className={styles.title} style={{ color }}>{moduleName}</span>
      </div>
      <div className={styles.screenshot}>
        {sess.connecting && !sess.screenshot && (
          <div className={styles.connectingOverlay}>
            <div className={styles.spinner} />
            <div className={styles.connectingLabel}>Connecting…</div>
          </div>
        )}
        {sess.screenshot ? (
          <img src={`data:image/jpeg;base64,${sess.screenshot}`} alt="Browser" />
        ) : (
          !sess.connecting && (
            <div className={styles.placeholder}>
              {sess.connected ? 'Waiting for screenshot…' : 'Click Connect to start session'}
            </div>
          )
        )}
      </div>
      <div className={`${styles.action}${sess.action ? ' ' + styles.actionActive : ''}`}>
        {sess.action || 'Idle'}
      </div>
    </div>
  )
}
