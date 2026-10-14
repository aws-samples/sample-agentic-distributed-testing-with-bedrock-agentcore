import { useState, useEffect, useRef } from 'react'
import styles from './TcEditor.module.css'
import Btn from './Btn'
import Icon from './Icon'
import EditWithAiModal from './EditWithAiModal'
import BddHelpModal from './BddHelpModal'
import { useApi } from '../context/useApi'
import { toGherkin, fromGherkin } from '../utils/gherkin'
import { tabEdit, enterEdit } from '../utils/textEdit'

const SECTIONS = [
  { key: 'given', label: 'Given', placeholder: "e.g. I'm a signed-in customer with a credit card account" },
  { key: 'when', label: 'When', placeholder: 'e.g. I pay the full balance on my card' },
  { key: 'then', label: 'Then', placeholder: 'e.g. I see a confirmation and the balance shows as zero' },
]

const toDraft = (tc) => ({
  title: tc.title || '',
  given: [...(tc.given || [])],
  when: [...(tc.when || [])],
  then: [...(tc.then || [])],
})

// Drop blank rows and trim — the draft keeps blanks so a freshly added row can be typed into.
const clean = (d) => ({
  title: d.title.trim(),
  given: d.given.map(s => s.trim()).filter(Boolean),
  when: d.when.map(s => s.trim()).filter(Boolean),
  then: d.then.map(s => s.trim()).filter(Boolean),
})

export default function TcEditor({ tc, onApply, onDelete, readOnly = false }) {
  const [activeTab, setActiveTab] = useState('editor')   // 'editor' | 'gherkin'
  const [draft, setDraft] = useState(() => (tc ? toDraft(tc) : { title: '', given: [], when: [], then: [] }))
  const [gherkin, setGherkin] = useState(() => (tc ? toGherkin(tc) : ''))
  const [aiOpen, setAiOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [switchBlocked, setSwitchBlocked] = useState(false)
  const api = useApi()
  const focusNext = useRef(null)    // `${section}:${index}` to focus after the next render
  const inputs = useRef({})
  const gherkinRef = useRef(null)

  useEffect(() => {
    if (!tc) return
    setDraft(toDraft(tc))
    setGherkin(toGherkin(tc))
    setActiveTab('editor')
    setSwitchBlocked(false)
  }, [tc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusNext.current) return
    inputs.current[focusNext.current]?.focus()
    focusNext.current = null
  })

  if (!tc) return null

  const parsed = fromGherkin(gherkin)
  const onGherkin = activeTab === 'gherkin'
  const gherkinOk = parsed.errors.length === 0

  // The test case as the user currently sees it, from whichever tab is active.
  const current = () => {
    if (onGherkin) {
      return { ...tc, title: parsed.title.trim() || tc.title, given: parsed.given, when: parsed.when, then: parsed.then }
    }
    const c = clean(draft)
    return { ...tc, title: c.title || tc.title, given: c.given, when: c.when, then: c.then }
  }
  const canApply = !readOnly && (!onGherkin || gherkinOk)

  const show = (updated) => {          // refresh both views from one test case
    setDraft(toDraft(updated))
    setGherkin(toGherkin(updated))
  }

  const handleApply = () => {
    if (!canApply) return
    const updated = current()
    show(updated)
    onApply(updated)
  }

  const handleSaveFromAi = (e) => {
    const updated = { ...tc, title: e.title || tc.title, given: e.given, when: e.when, then: e.then }
    show(updated)
    onApply(updated)
    setAiOpen(false)
  }

  const handleSwitchTab = (tab) => {
    if (tab === activeTab) return
    if (tab === 'gherkin') {
      setGherkin(toGherkin({ ...tc, title: clean(draft).title || tc.title, ...clean(draft) }))
    } else {
      if (!gherkinOk) { setSwitchBlocked(true); return }   // don't throw away text that doesn't parse yet
      setDraft({ title: parsed.title.trim() || tc.title, given: parsed.given, when: parsed.when, then: parsed.then })
    }
    setSwitchBlocked(false)
    setActiveTab(tab)
  }

  // ── Gherkin tab: behave like a small code editor ────────────────────────
  // Apply an edit through the browser's own editing command (execCommand) so it
  // lands on the native undo stack — Ctrl+Z / Ctrl+Y keep working. If that isn't
  // available, fall back to setting the value directly (undo is lost, but the
  // edit still happens).
  const applyTextEdit = (el, edit) => {
    el.focus()
    el.setSelectionRange(edit.from, edit.to)
    const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, edit.text)
    if (!done) {
      const next = el.value.slice(0, edit.from) + edit.text + el.value.slice(edit.to)
      setGherkin(next)
      requestAnimationFrame(() => el.setSelectionRange(edit.selStart, edit.selEnd))
      return
    }
    el.setSelectionRange(edit.selStart, edit.selEnd)
  }

  const onGherkinKeyDown = (e) => {
    if (readOnly || e.nativeEvent.isComposing) return          // never interfere with IME input
    const el = e.currentTarget
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      applyTextEdit(el, tabEdit(el.value, el.selectionStart, el.selectionEnd, e.shiftKey))
    } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      applyTextEdit(el, enterEdit(el.value, el.selectionStart, el.selectionEnd))
    }
  }

  // ── Editor-tab row helpers ──────────────────────────────────────────────
  const setRow = (key, i, value) => setDraft(d => ({ ...d, [key]: d[key].map((s, j) => (j === i ? value : s)) }))
  const addRow = (key, at) => {
    setDraft(d => {
      const rows = [...d[key]]
      const idx = at === undefined ? rows.length : at
      rows.splice(idx, 0, '')
      focusNext.current = `${key}:${idx}`
      return { ...d, [key]: rows }
    })
  }
  const removeRow = (key, i) => setDraft(d => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }))
  const moveRow = (key, i, dir) => setDraft(d => {
    const rows = [...d[key]]
    const j = i + dir
    if (j < 0 || j >= rows.length) return d
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
    return { ...d, [key]: rows }
  })
  const onRowKey = (e, key, i) => {
    if (e.key === 'Enter') { e.preventDefault(); addRow(key, i + 1) }
    else if (e.key === 'Backspace' && draft[key][i] === '' && draft[key].length > 0) {
      e.preventDefault()
      removeRow(key, i)
      if (i > 0) focusNext.current = `${key}:${i - 1}`
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.topActions}>
        <Btn variant="primary" disabled={!canApply} onClick={handleApply}>
          <Icon name="check" />Apply Changes
        </Btn>
        <Btn disabled={readOnly || !canApply} onClick={() => setAiOpen(true)}
          title={!canApply && !readOnly ? 'Fix the Gherkin errors first' : 'Describe what to change, or pick a preset, and review the AI\'s edit before saving'}>
          <Icon name="auto_awesome" />Edit with AI
        </Btn>
        <Btn variant="danger" disabled={readOnly} style={{ marginLeft: 'auto' }} onClick={onDelete}><Icon name="delete" />Delete TC</Btn>
      </div>
      <div className={styles.tabs}>
        <div
          className={`${styles.tab}${activeTab === 'editor' ? ' ' + styles.tabActive : ''}`}
          onClick={() => handleSwitchTab('editor')}
        >
          Editor
        </div>
        <div
          className={`${styles.tab}${activeTab === 'gherkin' ? ' ' + styles.tabActive : ''}`}
          onClick={() => handleSwitchTab('gherkin')}
        >
          Gherkin
        </div>
        <button type="button" className={styles.infoBtn} title="How BDD works and the expected format" onClick={() => setHelpOpen(true)}>
          <Icon name="info" size={16} />
        </button>
      </div>

      {activeTab === 'editor' ? (
        <div className={styles.fieldsPane}>
          <div style={{ marginBottom: 14 }}>
            <span className={styles.idBadge}>{tc.id}</span>
          </div>
          <div className={styles.fieldSection}>
            <label className={styles.fieldLabel}>Scenario *</label>
            <input
              className={styles.fieldInput}
              value={draft.title}
              onChange={(e) => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="What this test case proves, in one line"
              disabled={readOnly}
            />
          </div>

          {SECTIONS.map(({ key, label, placeholder }) => (
            <div className={styles.stepGroup} key={key}>
              {draft[key].map((text, i) => (
                <div className={styles.stepRow} key={i}>
                  <span className={styles.stepKw}>{i === 0 ? label : 'And'}</span>
                  <input
                    ref={(el) => { inputs.current[`${key}:${i}`] = el }}
                    className={`${styles.fieldInput} ${styles.stepInput}`}
                    value={text}
                    onChange={(e) => setRow(key, i, e.target.value)}
                    onKeyDown={(e) => onRowKey(e, key, i)}
                    placeholder={i === 0 ? placeholder : ''}
                    disabled={readOnly}
                  />
                  <button type="button" className={styles.iconBtn} title="Move up" disabled={readOnly || i === 0} onClick={() => moveRow(key, i, -1)}><Icon name="arrow_upward" size={14} /></button>
                  <button type="button" className={styles.iconBtn} title="Move down" disabled={readOnly || i === draft[key].length - 1} onClick={() => moveRow(key, i, 1)}><Icon name="arrow_downward" size={14} /></button>
                  <button type="button" className={styles.iconBtn} title="Remove" disabled={readOnly} onClick={() => removeRow(key, i)}><Icon name="close" size={14} /></button>
                </div>
              ))}
              <button type="button" className={styles.addStep} disabled={readOnly} onClick={() => addRow(key)}>
                <Icon name="add" size={14} />{draft[key].length ? 'Add And step' : `Add ${label} step`}
              </button>
            </div>
          ))}
          <div className={styles.hint}>Press Enter in a step to add the next one. Plain language is fine — the agent works out the exact UI steps.</div>
        </div>
      ) : (
        <div className={styles.yamlPane}>
          <div className={styles.yamlToolbar}>
            <span className={styles.idBadge} style={{ padding: '2px 8px', fontSize: 12 }}>{tc.id}</span>
            <span className={styles.yamlHint}>
              Raw Gherkin — a <code>Scenario:</code>, then <code>Given:</code> / <code>When:</code> / <code>Then:</code> each with a <code>-</code> list of steps. <kbd>Tab</kbd> indents, <kbd>Shift</kbd>+<kbd>Tab</kbd> outdents.
            </span>
          </div>
          <textarea
            ref={gherkinRef}
            className={styles.yamlEditor}
            value={gherkin}
            onChange={(e) => { setGherkin(e.target.value); setSwitchBlocked(false) }}
            onKeyDown={onGherkinKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-label="Gherkin scenario"

            disabled={readOnly}
            placeholder={'Scenario: Customer pays the full card balance\n\nGiven:\n  - I am a signed-in customer with a credit card account\nWhen:\n  - I pay the full balance\nThen:\n  - I see a confirmation\n  - the balance shows as zero'}
          />
          {(parsed.errors.length > 0 || parsed.warnings.length > 0 || switchBlocked) && (
            <div className={styles.gherkinMsgs}>
              {switchBlocked && <div className={styles.gherkinErr}>Fix the errors below before switching to the Editor tab, so nothing you typed is lost.</div>}
              {parsed.errors.map((m, i) => <div key={'e' + i} className={styles.gherkinErr}>{m}</div>)}
              {parsed.warnings.map((m, i) => <div key={'w' + i} className={styles.gherkinWarn}>{m}</div>)}
            </div>
          )}
        </div>
      )}
      <BddHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <EditWithAiModal
        open={aiOpen}
        mode="edit"
        onClose={() => setAiOpen(false)}
        testCase={aiOpen ? current() : null}
        api={api}
        onSave={handleSaveFromAi}
      />
    </div>
  )
}
