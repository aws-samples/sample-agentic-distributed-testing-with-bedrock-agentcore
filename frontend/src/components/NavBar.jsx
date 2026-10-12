import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import styles from './NavBar.module.css'
import Icon from './Icon'
import Btn from './Btn'
import SettingsModal from './SettingsModal'
import { useApp } from '../context/AppContext'
import { useApi } from '../context/useApi'
import { useTheme } from '../context/useTheme'
import { useAuth, authRequired } from '../context/AuthContext'

export default function NavBar({ rightContent }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { state, dispatch } = useApp()
  const api = useApi()
  const { theme, toggleTheme } = useTheme()
  const { logout, tokens } = useAuth()

  // Ensure model + agentMode are loaded so the Settings modal has correct
  // defaults even on pages (Editor / Analysis) that don't otherwise call
  // /api/config or open a WebSocket.
  useEffect(() => {
    if (!state.model || !state.agentMode) {
      api.getConfig().then(cfg => {
        dispatch({
          type: 'SET_CONFIG',
          targetUrl: cfg.targetUrl,
          features: cfg.features,
          model: cfg.model || '',
          agentMode: cfg.agentMode || 'local',
        })
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Runtime detection: is the runtime selected in Settings (state.agentMode)
  // actually reachable? Re-checked when the selection changes and every 30s so
  // it follows a mode switch or a (re)deploy without a page reload.
  const [rt, setRt] = useState(null)   // { mode, ok, detail } | { error }
  const [rtChecking, setRtChecking] = useState(false)
  const mode = state.agentMode
  // useApi() returns a new object every render, so it must not be a dependency
  // here — that would re-run the effect on every render and keep resetting the
  // status to "Checking…". Key everything on `mode` alone.
  const checkRuntime = useCallback(async () => {
    if (!mode) return
    setRtChecking(true)
    try {
      const result = await api.getRuntimeHealth(mode)
      setRt(result)
    } catch (e) {
      setRt({ error: e.message })
    } finally {
      setRtChecking(false)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRt(null)   // don't show the previous mode's result while re-checking
    checkRuntime()
    const t = setInterval(checkRuntime, 30000)
    return () => clearInterval(t)
  }, [checkRuntime])

  const rtLabel = mode === 'local' ? 'Local runtime' : 'AgentCore runtime'
  const rtColor = !rt ? 'var(--text-muted)' : rt.error || !rt.ok ? 'var(--red)' : 'var(--green)'
  const rtText = !rt ? 'Checking…' : rt.error ? 'Backend offline' : rt.ok ? `${rtLabel} ready` : `${rtLabel} not found`
  const rtTitle = !rt ? `Checking ${rtLabel}…`
    : rt.error ? `Backend unreachable: ${rt.error}`
    : `${rt.detail}\n(click to re-check)`

  const handleSaveSettings = useCallback(async ({ model, mode }) => {
    try {
      await api.updateModel(model)
      dispatch({ type: 'SET_CONFIG', model, agentMode: mode })
    } catch (e) {
      console.error('Failed to update model:', e)
    }
  }, [api, dispatch])

  return (
    <header className={styles.header}>
      <span className={styles.logo}>App Test Automation</span>
      <span className={styles.sep} />
      <NavLink
        to="/"
        end
        className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}
        title="Step 1: Define test features and cases"
      >
        <span className={styles.stepNum}>1</span>
        <Icon name="edit_note" />Test Editor
      </NavLink>
      <NavLink
        to="/runner"
        className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}
        title="Step 2: Run tests against the target app"
      >
        <span className={styles.stepNum}>2</span>
        <Icon name="play_arrow" />Runner
      </NavLink>
      <NavLink
        to="/analysis"
        className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}
        title="Step 3: Review past runs and evidence"
      >
        <span className={styles.stepNum}>3</span>
        <Icon name="monitoring" />Analysis
      </NavLink>
      <span className={styles.spacer} />
      {rightContent}
      <button
        type="button"
        onClick={checkRuntime}
        title={rtTitle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 14, color: 'var(--text)', cursor: 'pointer' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: rtColor, opacity: rtChecking ? 0.5 : 1 }} />
        {rtText}
      </button>
      {authRequired() && (
        <Btn size="sm" onClick={logout} title={tokens?.access_token ? 'Sign out' : ''}>
          <Icon name="logout" />Sign out
        </Btn>
      )}
      <Btn size="sm" onClick={() => setSettingsOpen(true)}><Icon name="settings" />Settings</Btn>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentModel={state.model}
        currentMode={state.agentMode}
        api={api}
        onSave={handleSaveSettings}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </header>
  )
}
