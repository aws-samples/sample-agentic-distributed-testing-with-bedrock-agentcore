import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import styles from './EnhanceModal.module.css'

import { toRows } from '../utils/gherkin'

function same(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || [])
}

// A step row is "changed" when its text does not appear in the other side's
// same section, so moved/merged lines stand out without a full diff.
function Column({ heading, data, other, accent }) {
  const otherRows = toRows(other)
  const seen = (r) => otherRows.some(o => o.kind === r.kind && o.section === r.section && o.text === r.text)
  const rows = toRows(data)
  return (
    <div className={`${styles.col} ${accent ? styles.colAccent : ''}`}>
      <div className={styles.colHead}>{heading}</div>
      <div className={styles.gherkin}>
        {rows.map((r, i) => (
          <div key={i} className={`${styles.row} ${r.kind === 'scenario' ? styles.rowScenario : ''} ${!seen(r) ? styles.changed : ''}`}>
            <span className={styles.kw}>{r.kw}</span> {r.text}
          </div>
        ))}
      </div>
    </div>
  )
}

const PRESETS = [
  { key: 'formatting', label: 'Formatting', icon: 'format_align_left', hint: 'Tidy structure and wording only: right section, one idea per line, consistent voice.' },
  { key: 'ambiguous', label: 'More ambiguous', icon: 'auto_awesome', hint: 'Raise to intent level: fewer, higher-level lines; exact values kept.' },
]

// Two steps: first ask what the user has in mind, and only then call the AI.
// The result is shown as original vs. enhanced side by side; nothing is applied
// until the user clicks Save.
export default function EnhanceModal({ open, onClose, testCase, api, onSave }) {
  // idle = asking what to improve | loading | ready | error
  const [state, setState] = useState({ status: 'idle' })
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState([])

  const togglePreset = (key) => setFocus(f => (f.includes(key) ? f.filter(k => k !== key) : [...f, key]))

  const run = async () => {
    setState({ status: 'loading' })
    try {
      const r = await api.enhanceCase(testCase, { focus, instruction: note })
      setState({ status: 'ready', ...r })
    } catch (e) {
      setState({ status: 'error', error: e.message })
    }
  }

  useEffect(() => {
    // Reset every time the modal is opened: nothing is sent until the user submits.
    setState({ status: 'idle' })
    setNote('')
    setFocus([])
  }, [open])

  // The test case as it is right now, shown read-only while the user decides what to ask for.
  const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])
  const originalNow = { title: testCase?.title || '', given: asList(testCase?.given), when: asList(testCase?.when), then: asList(testCase?.then) }

  const canSubmit = focus.length > 0 || note.trim().length > 0
  const idle = state.status === 'idle'
  const ready = state.status === 'ready'
  const unchanged = ready && state.original.title === state.enhanced.title
    && ['given', 'when', 'then'].every(key => same(state.original[key], state.enhanced[key]))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Enhance by AI — ${testCase?.id || ''}`}
      width="min(1100px, 94vw)"
      footer={
        idle ? (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={!canSubmit} onClick={run}><Icon name="auto_awesome" />Enhance</Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => setState({ status: 'idle' })}><Icon name="edit" />Change request</Btn>
            {ready && <Btn onClick={run}><Icon name="refresh" />Regenerate</Btn>}
            <Btn onClick={onClose}>Discard</Btn>
            <Btn variant="primary" disabled={!ready || unchanged} onClick={() => onSave(state.enhanced)}>
              <Icon name="save" />Save
            </Btn>
          </>
        )
      }
    >
      {idle && (
        <div className={styles.cols}>
          <Column heading="Current version" data={originalNow} other={originalNow} />
          <div className={styles.ask}>
            <div className={styles.askQ}>What are you thinking?</div>
            <div className={styles.askSub}>Tell the AI what to improve in this test case, or start from a preset. Nothing changes until you review and click Save.</div>
            <div className={styles.presets}>
              {PRESETS.map(p => (
                <button
                  key={p.key}
                  type="button"
                  className={`${styles.preset} ${focus.includes(p.key) ? styles.presetOn : ''}`}
                  onClick={() => togglePreset(p.key)}
                  aria-pressed={focus.includes(p.key)}
                >
                  <span className={styles.presetTitle}><Icon name={p.icon} size={16} />{p.label}</span>
                  <span className={styles.presetHint}>{p.hint}</span>
                </button>
              ))}
            </div>
            <textarea
              className={styles.askBox}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — or describe it yourself, e.g. “merge the field checks into one line, but keep the exact error message”"
              autoFocus
            />
            {!canSubmit && <div className={styles.askNeed}>Pick a preset or write a note to continue.</div>}
          </div>
        </div>
      )}
      {state.status === 'loading' && (
        <div className={styles.center} role="status" aria-live="polite">
          <span className={styles.spinner}><Icon name="progress_activity" size={28} /></span>
          <div className={styles.workingText}>Working on it<span className={styles.dots} aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></div>
          <div className={styles.workingSub}>The AI is rewriting your test case. This usually takes a few seconds.</div>
        </div>
      )}
      {state.status === 'error' && (
        <div className={styles.error}>
          <strong>Couldn't enhance this test case.</strong>
          <div>{state.error}</div>
          <Btn onClick={run}><Icon name="refresh" />Try again</Btn>
        </div>
      )}
      {ready && (
        <>
          <div className={styles.asked}>
            <strong>Asked:</strong>{' '}
            {[...state.focus.map(k => PRESETS.find(p => p.key === k)?.label), state.instruction && `“${state.instruction}”`].filter(Boolean).join(' · ')}
          </div>
          {state.summary && <div className={styles.summary}><Icon name="auto_awesome" /> {state.summary}</div>}
          {unchanged && <div className={styles.note}>The AI made no changes — nothing needed to change for that request.</div>}
          <div className={styles.cols}>
            <Column heading="Original" data={state.original} other={state.enhanced} />
            <Column heading="Enhanced by AI" data={state.enhanced} other={state.original} accent />
          </div>
          <div className={styles.foot}>Highlighted lines differ from the other side. Save puts the enhanced scenario into the editor and applies it.</div>
        </>
      )}
    </Modal>
  )
}
