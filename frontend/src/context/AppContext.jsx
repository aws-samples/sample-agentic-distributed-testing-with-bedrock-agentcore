import React, { createContext, useContext, useReducer } from 'react'

const AppContext = createContext(null)

const initialState = {
  modules: [],
  testCases: {},        // module -> TestCase[]
  testResults: {},      // tcId -> { status, stepResults, reason }
  sessionStatus: {},    // module -> { connected, connecting, screenshot, action }
  activeModules: new Set(),
  currentRunId: null,
  stopping: false,
  targetUrl: '',
  model: '',
  agentMode: 'local',
  sessionLogs: {},      // module -> [{ts, msg, type, kind}]
  analyses: {},         // tcId -> string
  loadingAnalysis: new Set(),
  expandedIds: new Set(),
  filterStatus: 'ALL',
  gridMode: '4',
  focusedModule: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONFIG':
      return {
        ...state,
        targetUrl: action.targetUrl ?? state.targetUrl,
        model: action.model ?? state.model,
        agentMode: action.agentMode ?? state.agentMode,
        modules: action.modules ?? state.modules,
      }
    case 'SET_MODULES':
      return { ...state, modules: action.modules }
    case 'SET_CASES':
      return { ...state, testCases: { ...state.testCases, [action.module]: action.cases } }
    case 'SET_TEST_RESULT':
      return { ...state, testResults: { ...state.testResults, [action.tcId]: action.result } }
    case 'SET_SESSION_STATUS': {
      const prev = state.sessionStatus[action.module] || {}
      return {
        ...state,
        sessionStatus: {
          ...state.sessionStatus,
          [action.module]: { ...prev, ...action.status }
        }
      }
    }
    case 'SET_ACTIVE_MODULE': {
      const next = new Set(state.activeModules)
      if (action.active) next.add(action.module)
      else next.delete(action.module)
      return { ...state, activeModules: next }
    }
    case 'CLEAR_ACTIVE_MODULES':
      return { ...state, activeModules: new Set() }
    case 'SET_CURRENT_RUN_ID':
      return { ...state, currentRunId: action.runId }
    case 'SET_STOPPING':
      return { ...state, stopping: action.stopping }
    case 'APPEND_SESSION_LOG': {
      const prev = state.sessionLogs[action.module] || []
      const next = [...prev, action.entry]
      return {
        ...state,
        sessionLogs: { ...state.sessionLogs, [action.module]: next.slice(-500) }
      }
    }
    case 'CLEAR_SESSION_LOG':
      return { ...state, sessionLogs: { ...state.sessionLogs, [action.module]: [] } }
    case 'SET_ANALYSIS':
      return { ...state, analyses: { ...state.analyses, [action.tcId]: action.analysis } }
    case 'SET_LOADING_ANALYSIS': {
      const next = new Set(state.loadingAnalysis)
      if (action.loading) next.add(action.tcId)
      else next.delete(action.tcId)
      return { ...state, loadingAnalysis: next }
    }
    case 'TOGGLE_EXPAND': {
      const next = new Set(state.expandedIds)
      if (next.has(action.tcId)) next.delete(action.tcId)
      else next.add(action.tcId)
      return { ...state, expandedIds: next }
    }
    case 'SET_FILTER':
      return { ...state, filterStatus: action.filter }
    case 'SET_GRID_MODE':
      return { ...state, gridMode: action.mode }
    case 'SET_FOCUSED_MODULE':
      return { ...state, focusedModule: action.module }
    case 'RESET_ALL': {
      const clearedSessions = {}
      for (const k of Object.keys(state.sessionStatus)) {
        clearedSessions[k] = { connected: false, connecting: false, screenshot: null, action: '' }
      }
      const clearedLogs = {}
      for (const k of Object.keys(state.sessionLogs)) {
        clearedLogs[k] = []
      }
      return {
        ...state,
        testResults: {},
        analyses: {},
        loadingAnalysis: new Set(),
        activeModules: new Set(),
        currentRunId: null,
        stopping: false,
        sessionStatus: clearedSessions,
        sessionLogs: clearedLogs,
        focusedModule: null,
      }
    }
    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
