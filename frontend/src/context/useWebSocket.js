import { useEffect, useRef, useCallback } from 'react'
import { useApp } from './AppContext'
import { buildAuthedWsUrl } from './authFetch'

export function useWebSocket(onLog) {
  const { dispatch } = useApp()
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  // Set when the page using this hook goes away. Without it, closing the socket
  // in the cleanup fires onclose, which schedules a reconnect the cleanup already
  // missed — that leaves an orphan socket, and every orphan delivers every server
  // message again (the same Agent Log line, once per orphan).
  const disposed = useRef(false)

  const addSessionLog = useCallback((feature, msg, type, kind) => {
    const ts = new Date().toLocaleTimeString()
    dispatch({
      type: 'APPEND_SESSION_LOG',
      feature,
      entry: { ts, msg, type: type || '', kind: kind || '' },
    })
  }, [dispatch])

  const connect = useCallback(async () => {
    if (disposed.current) return
    const url = await buildAuthedWsUrl('/ws')
    // The page may have been left while the URL (and token) was being built.
    if (disposed.current) return
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      onLog?.('WebSocket connected', 'info')
    }

    ws.onclose = () => {
      // Closed on purpose (page left): say nothing and do not reconnect. A socket
      // that is no longer the current one must never revive itself either.
      if (disposed.current || wsRef.current !== ws) return
      onLog?.('WebSocket disconnected', 'warn')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {}

    ws.onmessage = (evt) => {
      if (disposed.current || wsRef.current !== ws) return   // a stale socket must not deliver anything
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
            features: msg.features,
            model: msg.model,
            agentMode: msg.agentMode,
          })
          break

        case 'screenshot':
          if (msg.sessionId) {
            dispatch({
              type: 'SET_SESSION_STATUS',
              feature: msg.sessionId,
              status: { screenshot: msg.data, action: msg.action || '' },
            })
          }
          break

        case 'session_status':
          if (msg.sessionId) {
            dispatch({
              type: 'SET_SESSION_STATUS',
              feature: msg.sessionId,
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
            dispatch({ type: 'SET_ACTIVE_FEATURE', feature: msg.sessionId, active: true })
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
              feature: msg.sessionId,
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
                feature: msg.sessionId,
                status: { action: msg.action },
              })
            }
          }
          break

        case 'feature_complete':
          dispatch({ type: 'SET_ACTIVE_FEATURE', feature: msg.feature, active: false })
          onLog?.(`Feature complete: ${msg.feature}`, 'pass')
          break

        case 'run_start':
          onLog?.(`Run started: ${msg.features.length} features in parallel`, 'info')
          break

        case 'run_complete':
          dispatch({ type: 'CLEAR_ACTIVE_FEATURES' })
          onLog?.(
            msg.stopped ? 'Run stopped by user' : 'All features complete',
            msg.stopped ? 'warn' : 'pass'
          )
          dispatch({ type: 'SET_CURRENT_RUN_ID', runId: null })
          dispatch({ type: 'SET_STOPPING', stopping: false })
          break

        case 'run_stopped':
          onLog?.('Stop acknowledged', 'warn')
          dispatch({ type: 'SET_STOPPING', stopping: true })
          break

        case 'test_results_snapshot':
          // Bulk-restore persisted results on reconnect / page refresh.
          // Includes RUNNING entries from in-flight runs (even ones already
          // stopping) and the set of features currently active, so Stop /
          // Stopping state reappears correctly after a page refresh.
          if (msg.results) {
            for (const [tcId, result] of Object.entries(msg.results)) {
              dispatch({ type: 'SET_TEST_RESULT', tcId, result })
            }
          }
          if (Array.isArray(msg.activeFeatures)) {
            for (const feat of msg.activeFeatures) {
              dispatch({ type: 'SET_ACTIVE_FEATURE', feature: feat, active: true })
            }
          }
          if (msg.currentRunId) {
            dispatch({ type: 'SET_CURRENT_RUN_ID', runId: msg.currentRunId })
          }
          dispatch({ type: 'SET_STOPPING', stopping: !!msg.stopping })
          break

        case 'feature_added':
          if (msg.features) dispatch({ type: 'SET_FEATURES', features: msg.features })
          break

        case 'feature_removed':
          if (msg.features) dispatch({ type: 'SET_FEATURES', features: msg.features })
          break

        case 'cases_updated':
          // Signal handled by page via a custom event
          if (msg.feature) {
            window.dispatchEvent(new CustomEvent('cases_updated', { detail: { feature: msg.feature } }))
          }
          break

        case 'run_archive_updated':
          // Fired as soon as a run starts and again after every test case
          // completes (see backend/src/routes/tests.js's persistProgress),
          // not just once at the very end — lets Analysis show a run live.
          if (msg.runId) {
            window.dispatchEvent(new CustomEvent('run_archive_updated', { detail: { runId: msg.runId } }))
          }
          break
      }
    }
  }, [dispatch, onLog, addSessionLog])

  useEffect(() => {
    disposed.current = false       // StrictMode runs effect -> cleanup -> effect on the same hook
    connect()
    return () => {
      disposed.current = true
      clearTimeout(reconnectTimer.current)
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return wsRef
}
