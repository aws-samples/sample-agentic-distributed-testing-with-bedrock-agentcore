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
          modules: cfg.modules,
          model: cfg.model || '',
          agentMode: cfg.agentMode || 'local',
        })
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveSettings = useCallback(async ({ model }) => {
    try {
      await api.updateModel(model)
      dispatch({ type: 'SET_CONFIG', model })
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
        title="Step 1: Define test modules and cases"
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
