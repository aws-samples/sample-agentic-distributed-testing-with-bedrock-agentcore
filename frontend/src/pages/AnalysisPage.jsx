import { useState, useEffect, useCallback, useRef } from 'react'
import NavBar from '../components/NavBar'
import RunHistoryList from '../components/RunHistoryList'
import TcEvidencePanel from '../components/TcEvidencePanel'
import Icon from '../components/Icon'
import { useWebSocket } from '../context/useWebSocket'
import styles from './AnalysisPage.module.css'

// ── helpers ────────────────────────────────────────────────────────────────────

function statusIconName(status) {
  switch (status) {
    case 'PASS': return 'check_circle'
    case 'FAIL': return 'cancel'
    case 'RUNNING': return 'progress_activity'
    default: return 'radio_button_unchecked'
  }
}

// ── Feature TC list (left column inside run detail) ─────────────────────────────

function RunFeatureList({ run, selectedTcId, onTcClick }) {
  const [expandedFeatures, setExpandedFeatures] = useState(new Set())
  const features = run?.features || {}
  const featureNames = Object.keys(features)

  // Auto-expand all on first load
  useEffect(() => {
    if (featureNames.length > 0) {
      setExpandedFeatures(new Set(featureNames))
    }
  }, [run?.runId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (featureNames.length === 0) {
    return (
      <div className={styles.noFeatures}>No features in this run.</div>
    )
  }

  const toggleFeature = (name) => {
    setExpandedFeatures(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className={styles.featureList}>
      {featureNames.map(featName => {
        const cases = features[featName]?.cases || []
        const passCount = cases.filter(c => c.status === 'PASS').length
        const failCount = cases.filter(c => c.status === 'FAIL').length
        const isExpanded = expandedFeatures.has(featName)

        return (
          <div key={featName} className={styles.featGroup}>
            <div
              className={styles.featHeader}
              onClick={() => toggleFeature(featName)}
            >
              <span className={styles.featChevron}>{isExpanded ? '▾' : '▸'}</span>
              <span className={styles.featName}>{featName}</span>
              <span className={styles.featCount}>{cases.length}</span>
              {failCount > 0 && (
                <span className={`status-badge status-FAIL ${styles.featBadge}`}>
                  {failCount}<Icon name="cancel" />
                </span>
              )}
              {passCount > 0 && (
                <span className={`status-badge status-PASS ${styles.featBadge}`}>
                  {passCount}<Icon name="check_circle" />
                </span>
              )}
            </div>

            {isExpanded && cases.map(tc => {
              const isSelected = tc.id === selectedTcId
              return (
                <div
                  key={tc.id}
                  className={`${styles.tcRow} ${isSelected ? styles.tcRowActive : ''}`}
                  onClick={() => onTcClick(tc.id === selectedTcId ? null : tc.id)}
                >
                  <span className={`status-badge status-${tc.status || 'PENDING'} ${styles.tcBadge}`}>
                    <Icon name={statusIconName(tc.status)} />
                  </span>
                  <span className={styles.tcId}>{tc.id}</span>
                  <span className={styles.tcTitle}>{tc.title}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── Run detail area (right side, two-column) ───────────────────────────────────

function RunDetail({ run }) {
  const [selectedTcId, setSelectedTcId] = useState(null)

  // Reset selection when run changes
  useEffect(() => { setSelectedTcId(null) }, [run?.runId])

  if (!run) {
    return (
      <div className={styles.noRunSelected}>
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <div style={{ fontSize: 14 }}>Select a run from the history</div>
        <div style={{ fontSize: 12 }}>Past test results will appear here</div>
      </div>
    )
  }

  // Flatten all TCs for evidence lookup
  const allTcs = []
  for (const featName of Object.keys(run.features || {})) {
    for (const tc of (run.features[featName]?.cases || [])) {
      allTcs.push(tc)
    }
  }
  const selectedTc = selectedTcId ? allTcs.find(t => t.id === selectedTcId) || null : null

  return (
    <div className={styles.runDetail}>
      {/* Left column: feature+TC list */}
      <div className={styles.tcListCol}>
        <div className={styles.tcListHeader}>
          <span className={styles.runDetailTitle}>
            {run.targetUrl
              ? <span className={styles.runDetailUrl}>{run.targetUrl}</span>
              : 'Run detail'
            }
          </span>
          {run.stopped && <span className={styles.stoppedBadge}>stopped</span>}
        </div>
        <div className={styles.tcListBody}>
          <RunFeatureList run={run} selectedTcId={selectedTcId} onTcClick={setSelectedTcId} />
        </div>
      </div>

      {/* Right column: TC evidence */}
      <div className={styles.evidenceCol}>
        <TcEvidencePanel tc={selectedTc} />
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AnalysisPage() {
  const [runs, setRuns] = useState([])
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRun, setSelectedRun] = useState(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analysis/runs')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRuns(data)
    } catch (e) {
      setError('Failed to load runs: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchRunDetail = useCallback(async (runId) => {
    setDetailLoading(true)
    setSelectedRun(null)
    try {
      const res = await fetch(`/api/analysis/runs/${encodeURIComponent(runId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelectedRun(data)
    } catch (e) {
      setError('Failed to load run detail: ' + e.message)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // Same fetch, but swaps the data in place with no loading spinner / blank
  // gap — used for live updates while a run is in progress, where a full
  // fetchRunDetail (which nulls selectedRun first) would flicker the panel
  // on every test case completion.
  const refreshRunDetail = useCallback(async (runId) => {
    try {
      const res = await fetch(`/api/analysis/runs/${encodeURIComponent(runId)}`)
      if (!res.ok) return
      const data = await res.json()
      setSelectedRun(data)
    } catch { /* ignore — next update will retry */ }
  }, [])

  useWebSocket()

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  // Backend now upserts the run archive as soon as a run starts and again
  // after every test case completes (not just once at the end), broadcasting
  // run_archive_updated each time — refresh the list live, and the open
  // detail view too if it's the run that just changed.
  const selectedRunIdRef = useRef(selectedRunId)
  selectedRunIdRef.current = selectedRunId
  useEffect(() => {
    const handler = (e) => {
      fetchRuns()
      if (e.detail?.runId && e.detail.runId === selectedRunIdRef.current) {
        refreshRunDetail(e.detail.runId)
      }
    }
    window.addEventListener('run_archive_updated', handler)
    return () => window.removeEventListener('run_archive_updated', handler)
  }, [fetchRuns, refreshRunDetail])

  const handleSelectRun = (runId) => {
    if (runId === selectedRunId) return
    setSelectedRunId(runId)
    fetchRunDetail(runId)
  }

  return (
    <div className={styles.page}>
      <NavBar />

      {error && (
        <div className={styles.errorBar}>
          ⚠ {error}
          <button className={styles.errorDismiss} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className={styles.main}>
        {/* Left: run history */}
        <RunHistoryList
          runs={runs}
          selectedRunId={selectedRunId}
          onSelect={handleSelectRun}
          onRefresh={fetchRuns}
        />

        {/* Right: run detail */}
        <div className={styles.rightArea}>
          {loading && !runs.length && (
            <div className={styles.loadingState}>Loading runs…</div>
          )}
          {detailLoading && (
            <div className={styles.loadingState}>Loading run detail…</div>
          )}
          {!detailLoading && (
            <RunDetail run={selectedRun} />
          )}
        </div>
      </div>
    </div>
  )
}
