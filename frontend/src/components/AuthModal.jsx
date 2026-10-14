import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import styles from './AuthModal.module.css'

const ROLES = [
  { role: 'admin', label: 'Admin', icon: 'admin_panel_settings', hint: 'Used for administration and privileged, admin-only features.' },
  { role: 'user', label: 'Regular user', icon: 'person', hint: 'Used for ordinary user flows, and the default when a test case does not say.' },
]

const blank = () => Object.fromEntries(ROLES.map(r => [r.role, { username: '', password: '', show: false }]))

/**
 * Credentials the agent can sign in with on the app under test: an Admin and a
 * Regular user. The passwords are real field values (masked, with an eye button
 * to reveal them), loaded from GET /api/config/auth rather than the general
 * /api/config, which never carries them.
 */
export default function AuthModal({ open, onClose, readOnly, onSaved }) {
  const [enabled, setEnabled] = useState(false)
  const [rows, setRows] = useState(blank)
  const [status, setStatus] = useState({ kind: 'loading' })   // loading | idle | saving | error

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus({ kind: 'loading' })
    fetch('/api/config/auth').then(r => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json() }).then(a => {
      if (cancelled) return
      const next = blank()
      for (const acc of a.accounts || []) {
        if (next[acc.role]) next[acc.role] = { username: acc.username || '', password: acc.password || '', show: false }
      }
      setEnabled(!!a.enabled)
      setRows(next)
      setStatus({ kind: 'idle' })
    }).catch(e => !cancelled && setStatus({ kind: 'error', error: `Couldn't load settings: ${e.message}` }))
    return () => { cancelled = true }
  }, [open])

  const setField = (role, patch) => setRows(r => ({ ...r, [role]: { ...r[role], ...patch } }))

  const save = async () => {
    setStatus({ kind: 'saving' })
    try {
      const accounts = ROLES.map(({ role }) => {
        const row = rows[role]
        return { role, username: row.username, password: row.password }
      })
      const res = await fetch('/api/config/auth', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, accounts }),
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = await res.json()
      onSaved?.(data.auth)
      onClose()
    } catch (e) {
      setStatus({ kind: 'error', error: `Save failed: ${e.message}` })
    }
  }

  const busy = status.kind === 'loading' || status.kind === 'saving'
  const filled = ROLES.filter(({ role }) => rows[role].username.trim()).length

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Authentication"
      width="min(560px, 94vw)"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={busy || readOnly} onClick={save}><Icon name="save" />Save</Btn>
        </>
      }
    >
      <div className={styles.body}>
        <label className={styles.toggle}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={busy || readOnly} />
          <Icon name="lock" />
          <span>The app under test needs a login</span>
        </label>
        <div className={styles.sub}>
          When on, the agent gets these accounts and signs in itself whenever a page asks. It picks Admin or Regular user to suit each test case.
          The starting values are the bundled sample app's demo logins; change them for your own app.
        </div>

        {ROLES.map(({ role, label, icon, hint }) => {
          const row = rows[role]
          return (
            <fieldset key={role} className={styles.card} disabled={!enabled || busy || readOnly}>
              <legend className={styles.legend}><Icon name={icon} size={16} />{label}</legend>
              <div className={styles.hint}>{hint}</div>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span>Username</span>
                  <input
                    type="text"
                    className={styles.input}
                    value={row.username}
                    onChange={(e) => setField(role, { username: e.target.value })}
                    autoComplete="off"
                    placeholder={role === 'admin' ? 'e.g. ADMIN001' : 'e.g. USER0001'}
                  />
                </label>
                <label className={styles.field}>
                  <span>Password</span>
                  <div className={styles.pwWrap}>
                    <input
                      type={row.show ? 'text' : 'password'}
                      className={styles.input}
                      value={row.password}
                      onChange={(e) => setField(role, { password: e.target.value })}
                      autoComplete="new-password"
                      placeholder="Password"
                    />
                    <button type="button" className={styles.eye} onClick={() => setField(role, { show: !row.show })} title={row.show ? 'Hide' : 'Show'}>
                      <Icon name={row.show ? 'visibility_off' : 'visibility'} size={16} />
                    </button>
                  </div>
                </label>
              </div>
            </fieldset>
          )
        })}

        {enabled && filled === 0 && <div className={styles.warn}>Turned on, but no username is filled in, so the agent won't be given any login.</div>}
        {status.kind === 'error' && <div className={styles.error}>{status.error}</div>}
        {readOnly && <div className={styles.note}>Read-only while a test run is in progress.</div>}
      </div>
    </Modal>
  )
}
