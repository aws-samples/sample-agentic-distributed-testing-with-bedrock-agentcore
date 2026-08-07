import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useWebSocket } from '../context/useWebSocket'
import { useApi } from '../context/useApi'
import NavBar from '../components/NavBar'
import ModulePanel from '../components/ModulePanel'
import BrowserCell from '../components/BrowserCell'
import FocusModal from '../components/FocusModal'
import Btn from '../components/Btn'
import Icon from '../components/Icon'
import { SEED_TEST_CASES } from '../data/seedTestCases'
import { useStickToBottom } from '../hooks/useStickToBottom'
import styles from './RunnerPage.module.css'

export default function RunnerPage() {
  const { state, dispatch } = useApp()
  const api = useApi()
  const [logs, setLogs] = useState([])
  const [logHeight, setLogHeight] = useState(() => {
    const saved = localStorage.getItem('logPanelHeight')
    return saved ? parseInt(saved, 10) : 80
  })
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedModule, setExpandedModule] = useState(null)
  const [stopped, setStopped] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [connectBtnText, setConnectBtnText] = useState('Connect')
  const [connectBtnDisabled, setConnectBtnDisabled] = useState(false)

  // Derived: a run is active if any module is running OR any TC is RUNNING
  // This survives page refresh because both activeModules and testResults are
  // restored from the backend on WS reconnect.
  const isRunning = state.activeModules.size > 0 ||
    Object.values(state.testResults).some(r => r.status === 'RUNNING')
  const dragRef = useRef({ dragging: false, startY: 0, startH: 0 })

  // Stop can't interrupt a test case already running inside the agent
  // runtime — it only takes effect once that module's current test case
  // finishes, so isRunning can stay true well after the Stop click. `stopping`
  // lives in global state (not local useState) and is restored from the
  // backend's reconnect snapshot, so it still shows "Stopping…" correctly
  // after a page refresh instead of reverting to a bare "Running".
  const stopping = state.stopping
  useEffect(() => {
    if (!isRunning && stopping) dispatch({ type: 'SET_STOPPING', stopping: false })
  }, [isRunning, stopping, dispatch])

  const addLog = useCallback((msg, type = '') => {
    const ts = new Date().toLocaleTimeString()
    setLogs(prev => {
      const next = [...prev, { ts, msg, type }]
      return next.slice(-200)
    })
  }, [])

  // Auto-scroll the run log to bottom — pauses when the user scrolls up
  const {
    ref: logPanelRef,
    atBottom: logAtBottom,
    newSinceScroll: logNewCount,
    scrollToBottom: scrollLogsToBottom,
  } = useStickToBottom([logs])

  useWebSocket(addLog)

  // Reload cases when backend signals update
  useEffect(() => {
    const handler = (e) => {
      const { module } = e.detail
      api.getModuleCases(module).then(res => {
        dispatch({ type: 'SET_CASES', module, cases: res.cases })
      }).catch(() => {})
    }
    window.addEventListener('cases_updated', handler)
    return () => window.removeEventListener('cases_updated', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Init
  useEffect(() => {
    async function init() {
      try {
        const cfg = await api.getConfig()
        dispatch({
          type: 'SET_CONFIG',
          targetUrl: cfg.targetUrl,
          modules: cfg.modules,
          model: cfg.model || '',
          agentMode: cfg.agentMode || 'local',
        })

        // Seed and load cases
        const byModule = {}
        for (const tc of SEED_TEST_CASES) {
          if (!byModule[tc.module]) byModule[tc.module] = []
          byModule[tc.module].push(tc)
        }

        await Promise.all((cfg.modules || []).map(async (mod) => {
          try {
            const res = await api.getModuleCases(mod)
            if (res.cases.length === 0) {
              const seeds = byModule[mod] || []
              for (const tc of seeds) {
                await api.addCase(mod, tc)
              }
              const res2 = await api.getModuleCases(mod)
              dispatch({ type: 'SET_CASES', module: mod, cases: res2.cases.length ? res2.cases : seeds })
            } else {
              dispatch({ type: 'SET_CASES', module: mod, cases: res.cases })
            }
          } catch (e) {
            const seeds = byModule[mod] || []
            dispatch({ type: 'SET_CASES', module: mod, cases: seeds })
          }
        }))

        // Check health for session status
        try {
          const health = await api.getHealth()
          addLog(`Backend ready. Model: ${health.model} | Target: ${health.targetUrl}`, 'info')
          for (const [sid, info] of Object.entries(health.sessions || {})) {
            dispatch({ type: 'SET_SESSION_STATUS', module: sid, status: { connected: info.connected } })
          }
        } catch (e) {
          addLog(`Backend check failed: ${e.message}. Retrying...`, 'warn')
          setTimeout(init, 3000)
        }
      } catch (e) {
        addLog(`Config load failed: ${e.message}`, 'fail')
        const fallbackModules = ['Authentication', 'Account Management', 'Card Management', 'Transaction Processing', 'Interest Calculation', 'Statement Generation', 'User Administration', 'Data Migration']
        dispatch({ type: 'SET_CONFIG', modules: fallbackModules, targetUrl: '', model: '', agentMode: 'local' })
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Draggable log panel
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragRef.current.dragging) return
      const delta = dragRef.current.startY - e.clientY
      const newH = Math.max(40, Math.min(400, dragRef.current.startH + delta))
      setLogHeight(newH)
    }
    const handleMouseUp = () => {
      if (dragRef.current.dragging) {
        dragRef.current.dragging = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        localStorage.setItem('logPanelHeight', String(logHeight))
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [logHeight])

  const handleDragStart = (e) => {
    dragRef.current = { dragging: true, startY: e.clientY, startH: logHeight }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  // Stats
  const allTcs = Object.values(state.testCases).flat()
  let statPending = 0, statRunning = 0, statPass = 0, statFail = 0
  for (const tc of allTcs) {
    const r = state.testResults[tc.id]
    const s = r ? r.status : 'PENDING'
    if (s === 'PENDING') statPending++
    else if (s === 'RUNNING') statRunning++
    else if (s === 'PASS') statPass++
    else if (s === 'FAIL') statFail++
  }

  // Filtered TCs for left panel
  const filteredTestCases = {}
  for (const mod of state.modules) {
    const tcs = state.testCases[mod] || []
    filteredTestCases[mod] = tcs.filter(tc => {
      const r = state.testResults[tc.id]
      const s = r ? r.status : 'PENDING'
      if (filterStatus !== 'ALL' && s !== filterStatus) return false
      if (searchQuery && !tc.id.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !tc.title.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
  }

  const handleModuleClick = (mod) => {
    setExpandedModule(prev => prev === mod ? null : mod)
  }

  // Connects (with retries) whichever of `targets` aren't already marked
  // connected in state.sessionStatus. Returns the list of modules that were
  // still unconnected after all retries — empty means every target is ready.
  // Shared by the standalone Connect button and handleRunAll's pre-flight
  // check, so "Run All" can never fire run_test against a session whose
  // agent-runtime tab hasn't finished initializing yet (that race is what
  // previously produced spurious "No verdict from agent" failures on
  // whichever module happened to still be connecting when tests started).
  const connectModules = useCallback(async (targets) => {
    const MAX_RETRIES = 3
    let pending = targets.filter(mod => !state.sessionStatus[mod]?.connected)
    let attempt = 0

    if (pending.length === 0) return []

    pending.forEach(mod => {
      dispatch({ type: 'SET_SESSION_STATUS', module: mod, status: { connecting: true } })
    })

    while (pending.length > 0 && attempt < MAX_RETRIES) {
      attempt++
      const isRetry = attempt > 1
      setConnectBtnText(isRetry ? `Retry ${attempt}/${MAX_RETRIES}…` : 'Connecting…')
      if (isRetry) addLog(`Retrying ${pending.length} failed session(s) (attempt ${attempt}/${MAX_RETRIES})…`, 'warn')
      else addLog(`Connecting ${pending.length} module session(s)…`, 'info')

      try {
        const results = await api.connectSessions(pending)
        const stillFailed = []
        for (const [mod, r] of Object.entries(results)) {
          dispatch({ type: 'SET_SESSION_STATUS', module: mod, status: { connecting: false, connected: r.connected } })
          if (!r.connected) stillFailed.push(mod)
        }
        pending = stillFailed
      } catch (e) {
        pending.forEach(mod => {
          dispatch({ type: 'SET_SESSION_STATUS', module: mod, status: { connecting: false } })
        })
        addLog(`Connect attempt ${attempt} failed: ${e.message}`, 'fail')
        break
      }

      if (pending.length > 0 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1500))
      }
    }

    if (pending.length > 0) {
      pending.forEach(mod => {
        dispatch({ type: 'SET_SESSION_STATUS', module: mod, status: { connecting: false } })
      })
      addLog(`${pending.length} session(s) failed after ${MAX_RETRIES} attempts: ${pending.join(', ')}`, 'fail')
    }
    setConnectBtnText('Connect')
    return pending
  }, [state.sessionStatus, api, addLog, dispatch])

  const handleConnect = async () => {
    setConnectBtnDisabled(true)
    const failed = await connectModules(state.modules)
    const connected = state.modules.length - failed.length
    addLog(`${connected}/${state.modules.length} sessions connected`, connected === state.modules.length ? 'pass' : 'warn')
    setConnectBtnDisabled(false)
  }

  const handleRunAll = async () => {
    if (!state.targetUrl) { addLog('Set a Target URL in Test Editor before running tests', 'warn'); return }
    const testCases = Object.values(state.testCases).flat()
    if (testCases.length === 0) { addLog('No tests to run', 'warn'); return }

    // Health-check every session before starting — a module whose
    // agent-runtime tab hasn't finished initializing yet would otherwise
    // race run_test and fail with "No verdict from agent" for no reason
    // related to the test itself.
    setConnectBtnDisabled(true)
    const modulesInRun = [...new Set(testCases.map(tc => tc.module))]
    const failed = await connectModules(modulesInRun)
    setConnectBtnDisabled(false)
    if (failed.length > 0) {
      addLog(`Aborting run — ${failed.length} session(s) never became healthy: ${failed.join(', ')}`, 'fail')
      return
    }

    setStopped(false)
    addLog(`Starting parallel run of ${testCases.length} tests across ${modulesInRun.length} modules...`, 'info')
    try {
      const { runId } = await api.runTests(testCases)
      dispatch({ type: 'SET_CURRENT_RUN_ID', runId })
      addLog(`Run started: ${runId}`, 'info')
    } catch (e) {
      addLog(`Failed to start run: ${e.message}`, 'fail')
    }
  }

  const handleStop = async () => {
    if (stopped) {
      // Resume
      setStopped(false)
      handleRunAll()
    } else {
      addLog('Stopping run...', 'warn')
      try {
        await api.stopRun()
        setStopped(true)
        dispatch({ type: 'SET_STOPPING', stopping: true })
        addLog('Stop requested — finishing in-flight test case(s)…', 'warn')
      } catch (e) {
        addLog(`Stop error: ${e.message}`, 'fail')
      }
    }
  }

  const handleReset = async () => {
    if (resetting) return
    setResetting(true)
    addLog('Reset — killing sessions and archiving in-flight results…', 'warn')
    try {
      await api.resetSessions()
      dispatch({ type: 'RESET_ALL' })
      setStopped(false)
      addLog('Reset complete — all sessions killed, screens and logs cleared', 'warn')
    } catch (e) {
      addLog(`Reset failed: ${e.message}`, 'fail')
    } finally {
      setResetting(false)
    }
  }

  const handleRequestAnalysis = async (tcId) => {
    let tc = null
    for (const tcs of Object.values(state.testCases)) {
      tc = tcs.find(t => t.id === tcId)
      if (tc) break
    }
    if (!tc) return
    const r = state.testResults[tcId]
    dispatch({ type: 'SET_LOADING_ANALYSIS', tcId, loading: true })
    addLog(`Requesting analysis for ${tcId}...`, 'info')
    try {
      const res = await api.requestAnalysis(tc, r?.stepResults || [], r ? JSON.stringify(r) : 'Unknown')
      dispatch({ type: 'SET_ANALYSIS', tcId, analysis: res.analysis })
      addLog(`Analysis complete for ${tcId}`, 'pass')
    } catch (e) {
      dispatch({ type: 'SET_ANALYSIS', tcId, analysis: `Error: ${e.message}` })
      addLog(`Analysis failed: ${e.message}`, 'fail')
    } finally {
      dispatch({ type: 'SET_LOADING_ANALYSIS', tcId, loading: false })
    }
  }

  const statsBar = (
    <div className={styles.statsBar}>
      <div className={styles.statItem}>
        <span className={`${styles.statValue} ${styles.statPending}`}>{statPending}</span>
        <span> pending</span>
      </div>
      <div className={styles.statItem}>
        <span className={`${styles.statValue} ${styles.statRun}`}>{statRunning}</span>
        <span> running</span>
      </div>
      <div className={styles.statItem}>
        <span className={`${styles.statValue} ${styles.statPass}`}>{statPass}</span>
        <span> pass</span>
      </div>
      <div className={styles.statItem}>
        <span className={`${styles.statValue} ${styles.statFail}`}>{statFail}</span>
        <span> fail</span>
      </div>
    </div>
  )

  // Runner left panel toolbar
  const leftToolbar = (
    <>
      <Btn variant="primary" disabled={resetting || isRunning || !state.targetUrl} onClick={handleRunAll}
        title={!state.targetUrl ? 'Set Target URL in Test Editor first' : resetting ? 'Resetting…' : isRunning ? 'Run in progress' : ''}>
        <Icon name="play_arrow" />Run All
      </Btn>
      <Btn variant="success" disabled={resetting || connectBtnDisabled} onClick={handleConnect}>
        <Icon name={connectBtnDisabled ? 'sync' : 'cable'} />
        {connectBtnText}
      </Btn>
      {isRunning && (
        <Btn variant={stopped && !stopping ? 'success' : 'danger'} disabled={resetting || stopping} onClick={handleStop}
          title={stopping ? 'Waiting for in-flight test case(s) to finish…' : ''}>
          {stopping ? <><Icon name="sync" />Stopping…</> : stopped ? <><Icon name="play_arrow" />Resume</> : <><Icon name="stop" />Stop</>}
        </Btn>
      )}
      <Btn onClick={handleReset} disabled={resetting} title={resetting ? 'Resetting in progress…' : 'Clear all session data, results, and connections'}>
        <Icon name={resetting ? 'sync' : 'restart_alt'} />{resetting ? 'Resetting…' : 'Reset'}
      </Btn>
      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <button
          className={`${styles.filterBtn}${filterStatus === 'ALL' ? ' ' + styles.filterBtnActive : ''}`}
          onClick={() => setFilterStatus('ALL')}
        >All</button>
        <button
          className={`${styles.filterBtn}${filterStatus === 'PENDING' ? ' ' + styles.filterBtnActive : ''}`}
          onClick={() => setFilterStatus('PENDING')}
        >Pending</button>
        <button
          className={`${styles.filterBtn}${filterStatus === 'PASS' ? ' ' + styles.filterBtnActive : ''}`}
          onClick={() => setFilterStatus('PASS')}
        >Pass</button>
        <button
          className={`${styles.filterBtn}${filterStatus === 'FAIL' ? ' ' + styles.filterBtnActive : ''}`}
          onClick={() => setFilterStatus('FAIL')}
        >Fail</button>
      </div>
    </>
  )

  return (
    <div className={styles.page}>
      <NavBar />
      <div className={styles.main}>
        <ModulePanel
          modules={state.modules}
          testCases={filteredTestCases}
          testResults={state.testResults}
          sessionStatus={state.sessionStatus}
          activeModules={state.activeModules}
          expandedModule={expandedModule}
          onModuleClick={handleModuleClick}
          showSessionIndicators={true}
          showStatusBadges={true}
          showTcDetail={true}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          toolbar={leftToolbar}
          statsBar={statsBar}
        />

        <div className={styles.rightPanel}>
          <div className={styles.rightToolbar}>
            <span className={styles.rightTitle}>
              Parallel Browser Sessions ({state.modules.length})
            </span>
            <div className={styles.viewToggle}>
              {['4', '2', '1'].map(m => (
                <button
                  key={m}
                  className={`${styles.viewBtn}${state.gridMode === m ? ' ' + styles.viewBtnActive : ''}`}
                  onClick={() => dispatch({ type: 'SET_GRID_MODE', mode: m })}
                >
                  {m === '4' ? '4-col' : m === '2' ? '2-col' : 'Focus'}
                </button>
              ))}
            </div>
          </div>

          <div className={`${styles.browserGrid} ${styles['grid' + state.gridMode]}`}>
            {state.modules.map(mod => (
              <BrowserCell
                key={mod}
                moduleName={mod}
                sessionStatus={state.sessionStatus[mod]}
                activeModules={state.activeModules}
                onFocus={() => dispatch({ type: 'SET_FOCUSED_MODULE', module: mod })}
              />
            ))}
          </div>

          <div className={styles.logWrap} style={{ position: 'relative' }}>
            <div className={styles.logDragHandle} onMouseDown={handleDragStart} />
            <div
              ref={logPanelRef}
              className={styles.logPanel}
              style={{ height: logHeight }}
            >
              {logs.map((entry, i) => (
                <div key={i} className={`${styles.logEntry} ${entry.type ? styles['logEntry_' + entry.type] : ''}`}>
                  [{entry.ts}] {entry.msg}
                </div>
              ))}
            </div>
            {!logAtBottom && logNewCount > 0 && (
              <button className={styles.resumePill} onClick={scrollLogsToBottom}>
                <Icon name="arrow_downward" />
                {logNewCount} new {logNewCount === 1 ? 'entry' : 'entries'}
              </button>
            )}
          </div>
        </div>
      </div>

      {state.focusedModule && (
        <FocusModal
          moduleName={state.focusedModule}
          testCases={state.testCases[state.focusedModule]}
          testResults={state.testResults}
          sessionStatus={state.sessionStatus[state.focusedModule]}
          sessionLogs={state.sessionLogs[state.focusedModule]}
          onClose={() => dispatch({ type: 'SET_FOCUSED_MODULE', module: null })}
          onClearLog={() => dispatch({ type: 'CLEAR_SESSION_LOG', module: state.focusedModule })}
        />
      )}
    </div>
  )
}
