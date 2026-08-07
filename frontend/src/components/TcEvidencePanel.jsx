import { useEffect, useState } from 'react'
import styles from './TcEvidencePanel.module.css'
import Icon from './Icon'
import { useStickToBottom } from '../hooks/useStickToBottom'

// Lazy-load presigned URL for an S3 snapshot key. The bucket is private,
// so each thumbnail asks the backend for a short-lived signed URL when
// the panel mounts (and again if the snapshots list changes).
function useSnapshotUrls(snapshots) {
  const [urls, setUrls] = useState({}) // key → url
  useEffect(() => {
    if (!snapshots?.length) { setUrls({}); return }
    let cancelled = false
    Promise.all(snapshots.map(async (snap) => {
      try {
        const res = await fetch(`/api/analysis/snapshot-url?key=${encodeURIComponent(snap.key)}`)
        if (!res.ok) return [snap.key, null]
        const data = await res.json()
        return [snap.key, data.url]
      } catch { return [snap.key, null] }
    })).then(pairs => {
      if (cancelled) return
      setUrls(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [snapshots])
  return urls
}

export default function TcEvidencePanel({ tc }) {
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const snapshots = tc?.snapshots || []
  const snapshotUrls = useSnapshotUrls(snapshots)

  useEffect(() => {
    if (lightboxIndex === null) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setLightboxIndex(null)
      else if (e.key === 'ArrowLeft') setLightboxIndex(i => (i - 1 + snapshots.length) % snapshots.length)
      else if (e.key === 'ArrowRight') setLightboxIndex(i => (i + 1) % snapshots.length)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxIndex, snapshots.length])

  const {
    ref: logBodyRef,
    atBottom: logAtBottom,
    newSinceScroll: logNewCount,
    scrollToBottom: scrollLogsToBottom,
  } = useStickToBottom([tc?.logs, tc?.id])

  if (!tc) {
    return (
      <div className={styles.empty}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.25">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
        <div style={{ fontSize: 14 }}>Select a test case to view evidence</div>
      </div>
    )
  }

  const status = tc.status || 'PENDING'
  const logs = tc.logs || []

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.tcHeader}>
        <span className={styles.tcId}>{tc.id}</span>
        <span className={styles.tcDot}>·</span>
        <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>
        <span className={styles.tcTitle}>{tc.title}</span>
      </div>

      <div className={styles.body}>
        {/* Verdict */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>AI VERDICT</div>
          <div className={`${styles.verdictBadge} ${styles['verdict_' + status]}`}>
            {statusLabel(status)}
          </div>
          {tc.reason && (
            <div className={styles.verdictReason}>{tc.reason}</div>
          )}
          {!tc.reason && (
            <div className={styles.verdictReason} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
              No verdict reason recorded.
            </div>
          )}
        </section>

        {/* Evidence snapshots from S3 */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>
            EVIDENCE SNAPSHOTS
            {snapshots.length > 0 && <span className={styles.snapCount}>{snapshots.length} frame{snapshots.length === 1 ? '' : 's'}</span>}
          </div>
          {snapshots.length === 0 && (
            <div className={styles.noScreenshot}>
              No snapshots captured for this test case.
            </div>
          )}
          {snapshots.length > 0 && (
            <div className={styles.snapGrid}>
              {snapshots.map((snap, i) => {
                const url = snapshotUrls[snap.key]
                const label = `Frame ${snap.seq || i + 1}`
                return (
                  <figure key={snap.key} className={styles.snapItem}>
                    {url ? (
                      <img
                        src={url}
                        alt={label}
                        className={styles.snapThumb}
                        loading="lazy"
                        onClick={() => setLightboxIndex(i)}
                      />
                    ) : (
                      <div className={styles.snapLoading}>Loading…</div>
                    )}
                    <figcaption className={styles.snapCaption}>
                      <span className={styles.snapSeq}>{label}</span>
                      {snap.action && <span className={styles.snapAction} title={snap.action}>{snap.action}</span>}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          )}
        </section>

        {/* Agent Log */}
        <section className={styles.section}>
          <div className={styles.sectionLabel}>AGENT LOG</div>
          <div className={styles.logPanel}>
            <div className={styles.logBody} ref={logBodyRef}>
              {logs.length === 0 && (
                <div className={styles.logEmpty}>No log entries</div>
              )}
              {logs.map((entry, i) => {
                const kind = entry.kind || entry.type || 'info'
                return (
                  <div key={i} className={`${styles.logEntry} ${styles['logEntry_' + kind] || styles.logEntry_info}`}>
                    {entry.ts && <span className={styles.logTs}>{entry.ts}</span>}
                    {entry.msg}
                  </div>
                )
              })}
            </div>
            {!logAtBottom && logNewCount > 0 && (
              <button className={styles.resumePill} onClick={scrollLogsToBottom}>
                <Icon name="arrow_downward" />
                {logNewCount} new {logNewCount === 1 ? 'entry' : 'entries'}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Click-to-enlarge lightbox */}
      {lightboxIndex !== null && (() => {
        const activeSnap = snapshots[lightboxIndex]
        const activeUrl = activeSnap && snapshotUrls[activeSnap.key]
        const canNav = snapshots.length > 1
        const goPrev = (e) => { e.stopPropagation(); setLightboxIndex(i => (i - 1 + snapshots.length) % snapshots.length) }
        const goNext = (e) => { e.stopPropagation(); setLightboxIndex(i => (i + 1) % snapshots.length) }
        return (
          <div className={styles.lightbox} onClick={() => setLightboxIndex(null)}>
            {canNav && (
              <button className={`${styles.lightboxNav} ${styles.lightboxNavPrev}`} onClick={goPrev} aria-label="Previous snapshot">
                <Icon name="chevron_left" size={28} />
              </button>
            )}
            {activeUrl && (
              <img src={activeUrl} alt="Snapshot full size" className={styles.lightboxImg} onClick={(e) => e.stopPropagation()} />
            )}
            {canNav && (
              <button className={`${styles.lightboxNav} ${styles.lightboxNavNext}`} onClick={goNext} aria-label="Next snapshot">
                <Icon name="chevron_right" size={28} />
              </button>
            )}
            <div className={styles.lightboxCounter}>{lightboxIndex + 1} / {snapshots.length}</div>
            <button className={styles.lightboxClose} onClick={() => setLightboxIndex(null)}>✕</button>
          </div>
        )
      })()}
    </div>
  )
}

function statusLabel(status) {
  const iconName = (
    status === 'PASS'    ? 'check_circle' :
    status === 'FAIL'    ? 'cancel' :
    status === 'RUNNING' ? 'progress_activity' :
                           'radio_button_unchecked'
  )
  const text = status === 'RUNNING' ? 'RUNNING…' : (status || 'PENDING')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon name={iconName} />
      {text}
    </span>
  )
}
