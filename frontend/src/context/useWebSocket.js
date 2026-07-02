import { useEffect, useRef, useCallback } from 'react'
import { useApp } from './AppContext'
import { buildAuthedWsUrl } from './authFetch'

export function useWebSocket(onLog) {
  const { dispatch } = useApp()
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)

  const addSessionLog = useCallback((module, msg, type, kind) => {
    const ts = new Date().toLocaleTimeString()
    dispatch({
      type: 'APPEND_SESSION_LOG',
      module,
      entry: { ts, msg, type: type || '', kind: kind || '' },
    })
  }, [dispatch])

  const connect = useCallback(async () => {
    const url = await buildAuthedWsUrl('/ws')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      onLog?.('WebSocket connected', 'info')
    }

    ws.onclose = () => {
      onLog?.('WebSocket disconnected', 'warn')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {}

    ws.onmessage = (evt) => {
      try {
        handleMessage(JSON.parse(evt.data))
      } catch (e) {}
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'config':
          dispatch({
            type: 'SET_CONFIG',
            targetUrl: msg.targetUrl,
            modules: msg.modules,
            model: msg.model,
            agentMode: msg.agentMode,
          })
          break

        case 'screenshot':
          if (msg.sessionId) {
            dispatch({
              type: 'SET_SESSION_STATUS',
              module: msg.sessionId,
              status: { screenshot: msg.data, action: msg.action || '' },
            })
          }
          break

        case 'session_status':
          if (msg.sessionId) {
            dispatch({
              type: 'SET_SESSION_STATUS',
              module: msg.sessionId,
              status: { connected: msg.connected },
            })
            addSessionLog(
              msg.sessionId,
              msg.connected ? 'Session connected' : 'Session disconnected',
              msg.connected ? 'pass' : 'warn',
              msg.connected ? 'pass' : 'warn'
            )
          }
          break

        case 'test_start':
          dispatch({ type: 'SET_TEST_RESULT', tcId: msg.testId, result: { status: 'RUNNING' } })
          if (msg.sessionId) {
            dispatch({ type: 'SET_ACTIVE_MODULE', module: msg.sessionId, active: true })
            addSessionLog(msg.sessionId, `▶ ${msg.testId}`, 'info', 'tool')
          }
          break

        case 'test_result':
          dispatch({
            type: 'SET_TEST_RESULT',
            tcId: msg.testId,
            result: { status: msg.status, stepResults: msg.stepResults, reason: msg.reason },
          })
          onLog?.(`${msg.testId}: ${msg.status}${msg.reason ? ' — ' + msg.reason : ''}`,
            msg.status === 'PASS' ? 'pass' : 'fail')
          if (msg.sessionId) {
            const kind = msg.status === 'PASS' ? 'pass' : 'fail'
            addSessionLog(
              msg.sessionId,
              `${msg.testId}: ${msg.status}${msg.reason ? ' — ' + msg.reason : ''}`,
              kind, kind
            )
          }
          break

        case 'test_skipped':
          dispatch({ type: 'SET_TEST_RESULT', tcId: msg.testId, result: { status: 'PENDING' } })
          break

        case 'action':
          if (msg.sessionId) {
            dispatch({
              type: 'SET_SESSION_STATUS',
              module: msg.sessionId,
              status: { action: msg.text || '' },
            })
            addSessionLog(msg.sessionId, msg.text || '', 'info', 'tool')
          }
          break

        case 'step_detail':
          if (msg.sessionId) {
            const kind = msg.kind || 'info'
            addSessionLog(msg.sessionId, msg.action, kind, kind)
            if (kind === 'tool') {
              dispatch({
                type: 'SET_SESSION_STATUS',
                module: msg.sessionId,
                status: { action: msg.action },
              })
            }
          }
          break

        case 'module_complete':
          dispatch({ type: 'SET_ACTIVE_MODULE', module: msg.module, active: false })
          onLog?.(`Module complete: ${msg.module}`, 'pass')
          break

        case 'run_start':
          onLog?.(`Run started: ${msg.modules.length} modules in parallel`, 'info')
          break

        case 'run_complete':
          dispatch({ type: 'CLEAR_ACTIVE_MODULES' })
          onLog?.(
            msg.stopped ? 'Run stopped by user' : 'All modules complete',
            msg.stopped ? 'warn' : 'pass'
          )
          dispatch({ type: 'SET_CURRENT_RUN_ID', runId: null })
          break

        case 'run_stopped':
          onLog?.('Stop acknowledged', 'warn')
          break

        case 'test_results_snapshot':
          // Bulk-restore persisted results on reconnect / page refresh.
          // Includes RUNNING entries from in-flight runs and the set of
          // modules currently active so the Stop button reappears mid-run.
          if (msg.results) {
            for (const [tcId, result] of Object.entries(msg.results)) {
              dispatch({ type: 'SET_TEST_RESULT', tcId, result })
            }
          }
          if (Array.isArray(msg.activeModules)) {
            for (const mod of msg.activeModules) {
              dispatch({ type: 'SET_ACTIVE_MODULE', module: mod, active: true })
            }
          }
          if (msg.currentRunId) {
            dispatch({ type: 'SET_CURRENT_RUN_ID', runId: msg.currentRunId })
          }
          break

        case 'module_added':
          if (msg.modules) dispatch({ type: 'SET_MODULES', modules: msg.modules })
          break

        case 'module_removed':
          if (msg.modules) dispatch({ type: 'SET_MODULES', modules: msg.modules })
          break

        case 'cases_updated':
          // Signal handled by page via a custom event
          if (msg.module) {
            window.dispatchEvent(new CustomEvent('cases_updated', { detail: { module: msg.module } }))
          }
          break
      }
    }
  }, [dispatch, onLog, addSessionLog])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return wsRef
}
