import Icon from './Icon'
import Btn from './Btn'
import styles from './SkillsEditor.module.css'
import { TOOLS } from '../tools'

let nextKey = 0   // stable React key per new row

export const blankSkill = (patch = {}) => ({ id: undefined, key: `n${++nextKey}`, name: '', text: '', tool: null, enabled: true, ...patch })

/** Rows from GET /api/config/skills. */
export const toSkillRows = (skills) => (skills || []).map(s => ({ ...blankSkill(), ...s, key: s.id }))

/** The skill as the API wants it. */
export const cleanSkills = (rows) => rows.filter(r => r.name.trim() || r.text.trim())
  .map(({ key, ...s }) => ({ ...s, name: s.name.trim() }))

/** Problems keyed by row index. */
export function validateSkills(rows, limits = { name: 80, text: 4000 }) {
  const errors = {}
  rows.forEach((r, i) => {
    if (!r.name.trim() && !r.text.trim()) return
    if (!r.name.trim()) errors[i] = 'Give the skill a name'
    else if (r.name.trim().length > limits.name) errors[i] = `The name is over ${limits.name} characters`
    else if (r.text.length > limits.text) errors[i] = `The text is over ${limits.text} characters`
  })
  return errors
}

/**
 * The Skills tab: global reusable instructions for the agent. A skill can be attached to a tool
 * (it is sent only while that tool is on) or be general. The agent reads them as notes (data).
 */
export default function SkillsEditor({ rows, onChange, errors, disabled, limits }) {
  const set = (i, patch) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const remove = (i) => {
    if (!window.confirm(`Delete the skill ${rows[i].name.trim() || i + 1}? It is deleted when you press Save.`)) return
    onChange(rows.filter((_, k) => k !== i))
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        Skills are notes that tell the agent how to use a tool or handle a kind of test, for example how to check a transaction row after a transfer. They apply to every run. The agent reads them as data: it is told to ignore instructions in them that conflict with its own rules.
      </div>
      {rows.length === 0 && <div className={styles.empty}>No skills yet.</div>}
      {rows.map((r, i) => (
        <div key={r.key} className={`${styles.card} ${errors?.[i] ? styles.bad : ''}`}>
          <div className={styles.line}>
            <input type="checkbox" checked={r.enabled} disabled={disabled} aria-label={`Skill ${i + 1} enabled`} onChange={(e) => set(i, { enabled: e.target.checked })} />
            <input className={`form-input ${styles.name}`} value={r.name} placeholder="name" disabled={disabled} maxLength={limits.name}
              aria-label={`Skill ${i + 1} name`} onChange={(e) => set(i, { name: e.target.value })} />
            <select className={`form-input ${styles.tool}`} value={r.tool || ''} disabled={disabled} aria-label={`Skill ${i + 1} attached to`}
              onChange={(e) => set(i, { tool: e.target.value || null })}>
              <option value="">General (no tool)</option>
              {TOOLS.map(t => <option key={t.id} value={t.id}>Tool: {t.name}</option>)}
            </select>
            <button type="button" className={styles.del} title="Delete skill" aria-label={`Delete ${r.name || 'skill'}`} disabled={disabled} onClick={() => remove(i)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <textarea className={`form-input ${styles.text}`} rows={5} value={r.text} disabled={disabled} spellCheck={false}
            placeholder="What the agent should know: what tables mean, what status codes stand for, example queries, how to check a result."
            aria-label={`Skill ${i + 1} text`} onChange={(e) => set(i, { text: e.target.value })} />
          <div className={styles.foot}>
            <span className={styles.count}>{r.text.length} / {limits.text}</span>
            {!r.enabled && <span className={styles.count}>Off: not sent to the agent</span>}
            {errors?.[i] && <span className={styles.err} role="alert">{errors[i]}</span>}
          </div>
        </div>
      ))}
      <Btn size="sm" onClick={() => onChange([...rows, blankSkill()])} disabled={disabled}><Icon name="add" />Add skill</Btn>
    </div>
  )
}
