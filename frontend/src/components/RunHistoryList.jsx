import styles from './RunHistoryList.module.css'
import Icon from './Icon'

function formatDateTime(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  if (isNaN(d)) return isoStr
  const month = d.toLocaleString('en-US', { month: 'short' })
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month} ${day}  ${hh}:${mm}`
}

function truncateUrl(url, max = 36) {
  if (!url) return ''
  try {
    const u = new URL(url)
    const s = u.hostname + (u.pathname !== '/' ? u.pathname : '')
    return s.length > max ? s.slice(0, max) + '…' : s
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url
  }
}

export default function RunHistoryList({ runs = [], selectedRunId, onSelect, onRefresh }) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Run History</span>
        <button className={`btn btn-sm ${styles.refreshBtn}`} onClick={onRefresh} title="Refresh">
          <Icon name="refresh" />
        </button>
      </div>

      <div className={styles.list}>
        {runs.length === 0 && (
          <div className={styles.empty}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>No runs yet</div>
          </div>
        )}

        {runs.map((run, idx) => {
          const isActive = run.runId === selectedRunId
          const { total = 0, pass = 0, fail = 0, pending = 0 } = run.summary || {}
          return (
            <div
              key={run.runId}
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              onClick={() => onSelect(run.runId)}
            >
              <div className={styles.itemTop}>
                <span className={styles.runNum}>Run #{runs.length - idx}</span>
                <span className={styles.runTime}>{formatDateTime(run.startedAt)}</span>
              </div>
              {run.targetUrl && (
                <div className={styles.targetUrl}>{truncateUrl(run.targetUrl)}</div>
              )}
              <div className={styles.badges}>
                {pass > 0 && (
                  <span className={styles.badge} data-type="pass">
                    {pass}<Icon name="check_circle" />
                  </span>
                )}
                {fail > 0 && (
                  <span className={styles.badge} data-type="fail">
                    {fail}<Icon name="cancel" />
                  </span>
                )}
                {pending > 0 && (
                  <span className={styles.badge} data-type="pending">
                    {pending}<Icon name="schedule" />
                  </span>
                )}
                {total === 0 && (
                  <span className={styles.badge} data-type="empty">0 TCs</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
