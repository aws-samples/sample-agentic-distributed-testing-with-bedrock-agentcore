import { useState } from 'react'
import Icon from './Icon'
import Btn from './Btn'
import styles from './EnvVarsEditor.module.css'

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/** Problems with a list of variables, keyed by row index. Empty object = fine. */
export function validateEnvVars(rows, reserved = ['TARGET_URL'], limits = { value: 2000, description: 500 }) {
  const errors = {}
  const seen = new Map()
  rows.forEach((r, i) => {
    const name = r.name.trim()
    if (!name && !r.value && !r.description) return            // an untouched blank row is simply ignored
    if (!name) errors[i] = 'Give it a name'
    else if (!NAME_RE.test(name)) errors[i] = 'Use letters, digits and _ only, starting with a letter or _'
    else if (reserved.includes(name.toUpperCase())) errors[i] = `${name} is built in`
    else if (seen.has(name.toUpperCase())) errors[i] = `${name} is already used above`
    else if (r.value.length > limits.value) errors[i] = `Value is over ${limits.value} characters`
    else if (r.description.length > limits.description) errors[i] = `Description is over ${limits.description} characters`
    if (name && !seen.has(name.toUpperCase())) seen.set(name.toUpperCase(), i)
  })
  return errors
}

/** The rows to send: drop blank rows, trim names. */
export const cleanEnvVars = (rows) =>
  rows.filter(r => r.name.trim() || r.value || r.description)
    .map(r => ({ name: r.name.trim(), value: r.value, description: r.description, secret: !!r.secret }))

/**
 * Context variables for the testing agent. The built-in ones (Target URL, logins) are listed
 * read-only so it is clear what the agent already knows; yours go below with a value and a
 * description saying WHEN the agent should use it.
 *
 * rows: [{ name, value, description, secret }]   builtIn: [{ name, value, description, where }]
 */
export default function EnvVarsEditor({ rows, onChange, builtIn, errors, disabled }) {
  const [shown, setShown] = useState({})           // row index -> value revealed
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const remove = (i) => { onChange(rows.filter((_, k) => k !== i)); setShown({}) }
  const add = () => onChange([...rows, { name: '', value: '', description: '', secret: false }])

  return (
    <div className={styles.wrap}>
      <div className={styles.builtIn}>
        {builtIn.map(b => (
          <div key={b.name} className={styles.bRow}>
            <code className={styles.bName}>{b.name}</code>
            <span className={styles.bValue}>{b.value || <em>not set</em>}</span>
            <span className={styles.bTag} title={b.description}>built in · {b.where}</span>
          </div>
        ))}
      </div>

      {rows.length === 0 && (
        <div className={styles.empty}>
          No custom variables yet. Add one for anything the agent may need that isn't a login or the URL — for example a promo code, an environment name or a test account number.
        </div>
      )}

      {rows.map((r, i) => (
        <div key={i} className={`${styles.card} ${errors?.[i] ? styles.bad : ''}`}>
          <div className={styles.line}>
            <input
              className={`form-input ${styles.name}`} value={r.name} placeholder="NAME" spellCheck={false} disabled={disabled}
              aria-label={`Variable ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })}
            />
            <span className={styles.eq}>=</span>
            <div className={styles.valueWrap}>
              <input
                className={`form-input ${styles.value}`} value={r.value} placeholder="value" spellCheck={false} disabled={disabled}
                type={r.secret && !shown[i] ? 'password' : 'text'} autoComplete="off"
                aria-label={`Variable ${i + 1} value`} onChange={(e) => set(i, { value: e.target.value })}
              />
              {r.secret && (
                <button type="button" className={styles.eye} title={shown[i] ? 'Hide' : 'Show'}
                  onClick={() => setShown(s => ({ ...s, [i]: !s[i] }))}>
                  <Icon name={shown[i] ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              )}
            </div>
            <button type="button" className={styles.del} title="Remove variable" aria-label={`Remove ${r.name || 'variable'}`}
              disabled={disabled} onClick={() => remove(i)}><Icon name="close" size={16} /></button>
          </div>
          <textarea
            className={`form-input ${styles.desc}`} rows={2} value={r.description} disabled={disabled}
            placeholder="When should the agent use this? e.g. “Use when a checkout test asks for a discount code.”"
            aria-label={`Variable ${i + 1} description`} onChange={(e) => set(i, { description: e.target.value })}
          />
          <div className={styles.foot}>
            <label className={styles.secret}>
              <input type="checkbox" checked={!!r.secret} disabled={disabled} onChange={(e) => set(i, { secret: e.target.checked })} />
              Mask the value here
            </label>
            {!r.description.trim() && r.name.trim() && <span className={styles.warn}>No description: the agent will only use it if a test case names it.</span>}
            {errors?.[i] && <span className={styles.err} role="alert">{errors[i]}</span>}
          </div>
        </div>
      ))}

      <Btn size="sm" onClick={add} disabled={disabled}><Icon name="add" />Add variable</Btn>
    </div>
  )
}
