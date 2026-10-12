import styles from './BrowserCell.module.css'
import { featureColor } from '../data/seedTestCases'

export default function BrowserCell({ featureName, sessionStatus, activeFeatures, onFocus }) {
  const sess = sessionStatus || {}
  const isRunning = activeFeatures?.has(featureName)
  const color = featureColor(featureName)

  let connClass = styles.conn + ' ' + styles.connDisconnected
  if (isRunning) connClass = styles.conn + ' ' + styles.connRunning
  else if (sess.connecting) connClass = styles.conn + ' ' + styles.connConnecting
  else if (sess.connected) connClass = styles.conn + ' ' + styles.connConnected

  return (
    <div className={`${styles.cell}${isRunning ? ' ' + styles.activeFeature : ''}`}>
      <div className={styles.header} onClick={onFocus}>
        <div className={connClass} />
        <span className={styles.title} style={{ color }}>{featureName}</span>
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
