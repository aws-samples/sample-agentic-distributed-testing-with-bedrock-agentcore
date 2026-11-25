import { useState } from 'react'
import Icon from './Icon'
import styles from './ToolsEditor.module.css'
import { TOOLS } from '../tools'

/**
 * The Tools tab: one card per registered tool with an on/off switch, what it does, and its own
 * settings (collapsed). enabled: { [toolId]: boolean }. ctx: the shared state the panels read.
 */
export default function ToolsEditor({ enabled, onToggle, ctx, disabled, api }) {
  const [open, setOpen] = useState({ database: true })
  return (
    <div className={styles.wrap}>
      {TOOLS.map(t => {
        const on = enabled[t.id] !== false
        const Panel = t.Panel
        return (
          <div key={t.id} className={styles.card}>
            <div className={styles.head}>
              <label className={styles.switch}>
                <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle(t.id, e.target.checked)} aria-label={`${t.name} tool on`} />
                <span className={styles.name}>{t.name}</span>
              </label>
              <span className={on ? styles.on : styles.off}>{on ? 'On' : 'Off'}</span>
              <button type="button" className={styles.expand} aria-expanded={!!open[t.id]} onClick={() => setOpen(o => ({ ...o, [t.id]: !o[t.id] }))}>
                <Icon name={open[t.id] ? 'expand_less' : 'expand_more'} size={16} />Settings
              </button>
            </div>
            <div className={styles.desc}>{t.description}</div>
            {open[t.id] && <div className={styles.panel}><Panel {...t.panelProps(ctx)} disabled={disabled} api={api} /></div>}
          </div>
        )
      })}
    </div>
  )
}
