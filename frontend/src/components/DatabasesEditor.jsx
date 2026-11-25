import { useState } from 'react'
import Icon from './Icon'
import Btn from './Btn'
import styles from './DatabasesEditor.module.css'

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const DEFAULT_PORT = { postgres: 5432, mysql: 3306 }

export const blankConnection = () => ({
  name: '', type: 'postgres', host: '', port: '', database: '', user: '', password: '', hasPassword: false,
  passwordChanged: false, ssl: 'off', description: '', allowWrite: false,
})

/** Rows from GET /api/config/databases (which never carries a password). */
export const toRows = (connections) => (connections || []).map(c => ({ ...blankConnection(), ...c, port: c.port ?? '', password: '' }))

/** Problems keyed by row index. Empty object = fine. An untouched blank row is ignored. */
export function validateDatabases(rows, limits = { description: 4000 }) {
  const errors = {}
  const seen = new Set()
  rows.forEach((r, i) => {
    const name = r.name.trim()
    if (!name && !r.host && !r.database && !r.user) return
    if (!NAME_RE.test(name)) errors[i] = 'Give it a name: letters, digits and _ only, starting with a letter or _'
    else if (seen.has(name.toLowerCase())) errors[i] = `${name} is already used above`
    else if (!r.host.trim()) errors[i] = 'Host is required'
    else if (r.port !== '' && !(Number(r.port) > 0 && Number(r.port) < 65536)) errors[i] = 'Port must be 1-65535'
    else if (!r.database.trim()) errors[i] = 'Database is required'
    else if (!r.user.trim()) errors[i] = 'User is required'
    else if (r.description.length > limits.description) errors[i] = `Description is over ${limits.description} characters`
    seen.add(name.toLowerCase())
  })
  return errors
}

/** The connection as the API wants it; the password is sent only when it was typed. */
export const toConnection = (r) => {
  const { hasPassword, passwordChanged, password, port, ...rest } = r
  return { ...rest, name: r.name.trim(), port: port === '' ? undefined : Number(port), ...(passwordChanged ? { password } : {}) }
}
export const cleanDatabases = (rows) => rows.filter(r => r.name.trim() || r.host || r.database || r.user).map(toConnection)

/**
 * Database connections the testing agent can read during a run (read-only by default).
 * rows: see blankConnection. api: { testDatabase, loadDatabaseSchema }.
 */
export default function DatabasesEditor({ rows, onChange, errors, disabled, api }) {
  const [shown, setShown] = useState({})        // row index -> password revealed
  const [result, setResult] = useState({})      // row index -> { busy, ok, message }
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const remove = (i) => { onChange(rows.filter((_, k) => k !== i)); setShown({}); setResult({}) }
  const add = () => onChange([...rows, blankConnection()])
  const setRes = (i, v) => setResult(s => ({ ...s, [i]: v }))

  const run = async (i, kind) => {
    const r = rows[i]
    setRes(i, { busy: kind })
    try {
      const out = kind === 'test' ? await api.testDatabase(toConnection(r)) : await api.loadDatabaseSchema(toConnection(r))
      if (kind === 'schema' && out.ok) {
        set(i, { description: r.description.trim() ? `${r.description.trim()}\n\n${out.draft}` : out.draft })
        setRes(i, { ok: true, message: 'Schema added to the description. Edit it to explain what the data means.' })
      } else setRes(i, { ok: out.ok, message: out.message })
    } catch (e) { setRes(i, { ok: false, message: e.message }) }
  }

  return (
    <div className={styles.wrap}>
      {rows.length === 0 && (
        <div className={styles.empty}>
          No database connections yet. Add one so the agent can check what the application stored (balances, ledger rows, audit records). Use a <strong>read-only database user</strong> on test or staging data, never production.
        </div>
      )}

      {rows.map((r, i) => {
        const res = result[i]
        return (
          <div key={i} className={`${styles.card} ${errors?.[i] ? styles.bad : ''}`}>
            <div className={styles.line}>
              <input className={`form-input ${styles.name}`} value={r.name} placeholder="name" spellCheck={false} disabled={disabled}
                aria-label={`Connection ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })} />
              <select className={`form-input ${styles.type}`} value={r.type} disabled={disabled} aria-label={`Connection ${i + 1} type`}
                onChange={(e) => set(i, { type: e.target.value })}>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
              <input className={`form-input ${styles.host}`} value={r.host} placeholder="host" spellCheck={false} disabled={disabled}
                aria-label={`Connection ${i + 1} host`} onChange={(e) => set(i, { host: e.target.value })} />
              <input className={`form-input ${styles.port}`} value={r.port} placeholder={String(DEFAULT_PORT[r.type])} inputMode="numeric" disabled={disabled}
                aria-label={`Connection ${i + 1} port`} onChange={(e) => set(i, { port: e.target.value.replace(/\D/g, '') })} />
              <button type="button" className={styles.del} title="Remove connection" aria-label={`Remove ${r.name || 'connection'}`}
                disabled={disabled} onClick={() => remove(i)}><Icon name="close" size={16} /></button>
            </div>
            <div className={styles.line}>
              <input className={`form-input ${styles.field}`} value={r.database} placeholder="database" spellCheck={false} disabled={disabled}
                aria-label={`Connection ${i + 1} database`} onChange={(e) => set(i, { database: e.target.value })} />
              <input className={`form-input ${styles.field}`} value={r.user} placeholder="user (read-only)" spellCheck={false} autoComplete="off" disabled={disabled}
                aria-label={`Connection ${i + 1} user`} onChange={(e) => set(i, { user: e.target.value })} />
              <div className={styles.valueWrap}>
                <input className={`form-input ${styles.pw}`} value={r.password} disabled={disabled} autoComplete="new-password" spellCheck={false}
                  type={shown[i] ? 'text' : 'password'} placeholder={r.hasPassword && !r.passwordChanged ? '•••••• (saved)' : 'password'}
                  aria-label={`Connection ${i + 1} password`} onChange={(e) => set(i, { password: e.target.value, passwordChanged: true })} />
                <button type="button" className={styles.eye} title={shown[i] ? 'Hide' : 'Show'} onClick={() => setShown(s => ({ ...s, [i]: !s[i] }))}>
                  <Icon name={shown[i] ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>
              <select className={`form-input ${styles.type}`} value={r.ssl} disabled={disabled} aria-label={`Connection ${i + 1} SSL`}
                onChange={(e) => set(i, { ssl: e.target.value })}>
                <option value="off">SSL off</option>
                <option value="require">SSL (no cert check)</option>
                <option value="verify">SSL (verify cert)</option>
              </select>
            </div>
            <textarea className={`form-input ${styles.desc}`} rows={4} value={r.description} disabled={disabled}
              placeholder="What does this database hold? How do the tables relate? What do status codes mean? Example queries. The agent reads this as notes (data), not instructions."
              aria-label={`Connection ${i + 1} description`} onChange={(e) => set(i, { description: e.target.value })} />
            <div className={styles.foot}>
              <Btn size="sm" disabled={disabled || !!res?.busy || !!errors?.[i] || !r.name.trim()} onClick={() => run(i, 'test')}>
                {res?.busy === 'test' ? 'Testing…' : 'Test connection'}
              </Btn>
              <Btn size="sm" disabled={disabled || !!res?.busy || !!errors?.[i] || !r.name.trim()} onClick={() => run(i, 'schema')}>
                {res?.busy === 'schema' ? 'Loading…' : 'Load schema'}
              </Btn>
              <label className={styles.check}>
                <input type="checkbox" checked={r.allowWrite} disabled={disabled} onChange={(e) => set(i, { allowWrite: e.target.checked })} />
                Allow writes
              </label>
              {r.allowWrite && <span className={styles.danger}>The agent may change data on this connection. Test data only.</span>}
              {res && !res.busy && <span className={res.ok ? styles.okMsg : styles.failMsg} role="status">{res.message}</span>}
              {errors?.[i] && <span className={styles.err} role="alert">{errors[i]}</span>}
            </div>
          </div>
        )
      })}

      <Btn size="sm" onClick={add} disabled={disabled}><Icon name="add" />Add connection</Btn>
    </div>
  )
}
