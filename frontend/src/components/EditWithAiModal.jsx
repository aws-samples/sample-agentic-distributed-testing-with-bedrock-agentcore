import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import styles from './EditWithAiModal.module.css'

import { toRows } from '../utils/gherkin'

function same(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || [])
}

// A step row is "changed" when its text does not appear in the other side's
// same section, so moved/merged lines stand out without a full diff. `plain`
// turns that off (a brand-new draft has nothing to compare against).
function Column({ heading, data, other, accent, plain }) {
  const otherRows = toRows(other)
  // Headers are structure, never "changed"; only the scenario line and the steps are compared.
  const seen = (r) => r.kind === 'header' || otherRows.some(o => o.kind === r.kind && o.section === r.section && o.text === r.text)
  const rows = toRows(data)
  return (
    <div className={`${styles.col} ${accent ? styles.colAccent : ''}`}>
      <div className={styles.colHead}>{heading}</div>
      <div className={styles.gherkin}>
        {rows.map((r, i) => (
          <div key={i} className={`${styles.row} ${r.kind === 'scenario' ? styles.rowScenario : ''} ${r.kind === 'header' ? styles.rowHeader : ''} ${!plain && !seen(r) ? styles.changed : ''}`}>
            <span className={styles.kw}>{r.kw}</span>{r.text ? ' ' + r.text : ''}
          </div>
        ))}
      </div>
    </div>
  )
}

const PRESETS = [
  { key: 'formatting', label: 'Formatting', icon: 'format_align_left',
    hint: 'Tidy structure and wording only: right section, one idea per line, consistent voice.' },
  { key: 'ambiguous', label: 'More ambiguous', icon: 'auto_awesome',
    hint: 'Raise to intent level: fewer, higher-level lines; exact values kept.' },
]

const EMPTY = { title: '', given: [], when: [], then: [] }
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])

/**
 * One modal for both flows. The AI only runs after the user submits.
 *
 *   mode="edit"    improve an existing test case (testCase). Shows the current
 *                  version beside the prompt, then original vs. edited.
 *   mode="create"  draft a new test case for `feature` ({ name, background,
 *                  existingTitles }) from a description. There is nothing to
 *                  compare against, so the prompt is the whole first screen and
 *                  the result is just the draft.
 *
 * Nothing is applied until the user clicks the primary button (Save / Add).
 */
export default function EditWithAiModal({ open, onClose, mode = 'edit', testCase, feature, api, onSave }) {
  const creating = mode === 'create'
  // idle = asking what the user has in mind | loading | ready | error
  const [state, setState] = useState({ status: 'idle' })
  const [note, setNote] = useState('')
  const [focus, setFocus] = useState([])

  const togglePreset = (key) => setFocus(f => (f.includes(key) ? f.filter(k => k !== key) : [...f, key]))

  const run = async () => {
    setState({ status: 'loading' })
    try {
      const r = await api.editWithAi({
        mode,
        testCase: creating ? undefined : testCase,
        feature: creating ? feature : undefined,
        focus: creating ? [] : focus,
        instruction: note,
      })
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
  }, [open, mode])

  // The test case as it is right now, shown read-only while the user decides what to ask for.
  const originalNow = { title: testCase?.title || '', given: asList(testCase?.given), when: asList(testCase?.when), then: asList(testCase?.then) }

  // Create needs a description (there is nothing else to work from); edit accepts a preset or a note.
  const canSubmit = creating ? note.trim().length > 0 : (focus.length > 0 || note.trim().length > 0)
  const idle = state.status === 'idle'
  const ready = state.status === 'ready'
  const unchanged = ready && !creating && state.original.title === state.enhanced.title
    && ['given', 'when', 'then'].every(key => same(state.original[key], state.enhanced[key]))

  const heading = creating
    ? `Add test case${feature?.name ? ` — ${feature.name}` : ''}`
    : `Edit with AI — ${testCase?.id || ''}`
  const wide = creating ? (ready ? 'min(720px, 94vw)' : 'min(620px, 94vw)') : 'min(1100px, 94vw)'

  const askedLine = ready && [
    ...(state.focus || []).map(k => PRESETS.find(p => p.key === k)?.label),
    state.instruction && `\u201c${state.instruction}\u201d`,
  ].filter(Boolean).join(' \u00b7 ')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={heading}
      width={wide}
      footer={
        idle ? (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={!canSubmit} onClick={run}>
              <Icon name="auto_awesome" />{creating ? 'Draft with AI' : 'Edit'}
            </Btn>
          </>
        ) : (
          <>
            <Btn onClick={() => setState({ status: 'idle' })}><Icon name="edit" />Change request</Btn>
            {ready && <Btn onClick={run}><Icon name="refresh" />Regenerate</Btn>}
            <Btn onClick={onClose}>{creating ? 'Cancel' : 'Discard'}</Btn>
            <Btn variant="primary" disabled={!ready || unchanged} onClick={() => onSave(state.enhanced)}>
              <Icon name={creating ? 'add' : 'save'} />{creating ? 'Add test case' : 'Save'}
            </Btn>
          </>
        )
      }
    >
      {idle && (
        <div className={creating ? undefined : styles.cols}>
          {!creating && <Column heading="Current version" data={originalNow} other={originalNow} />}
          <div className={styles.ask}>
            <div className={styles.askQ}>{creating ? 'What should this test case check?' : 'What are you thinking?'}</div>
            <div className={styles.askSub}>
              {creating
                ? 'Describe it in your own words \u2014 the AI drafts the scenario. You review it before anything is added.'
                : 'Tell the AI what to improve in this test case, or start from a preset. Nothing changes until you review and click Save.'}
            </div>
            {creating && feature?.background && (
              <div className={styles.bgNote}><strong>Feature background</strong> (applies automatically): {feature.background}</div>
            )}
            <textarea
              className={styles.askBox}
              rows={creating ? 5 : 4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={creating
                ? 'e.g. paying more than the outstanding balance is rejected with \u201cAmount exceeds balance\u201d'
                : 'Optional \u2014 or describe it yourself, e.g. \u201cmerge the field checks into one line, but keep the exact error message\u201d'}
              autoFocus
            />
            {/* Presets rewrite existing text, so they only make sense when editing. */}
            {!creating && (
              <>
                <div className={styles.presetsLabel}>Or start from a preset</div>
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
              </>
            )}
            {!canSubmit && (
              <div className={styles.askNeed}>
                {creating ? 'Describe the test case to continue.' : 'Pick a preset or write a note to continue.'}
              </div>
            )}
          </div>
        </div>
      )}
      {state.status === 'loading' && (
        <div className={styles.center} role="status" aria-live="polite">
          <span className={styles.spinner}><Icon name="progress_activity" size={28} /></span>
          <div className={styles.workingText}>{creating ? 'Drafting' : 'Working on it'}<span className={styles.dots} aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></div>
          <div className={styles.workingSub}>
            {creating ? 'The AI is writing your test case. This usually takes a few seconds.' : 'The AI is rewriting your test case. This usually takes a few seconds.'}
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div className={styles.error}>
          <strong>{creating ? "Couldn't draft this test case." : "Couldn't edit this test case."}</strong>
          <div>{state.error}</div>
          <Btn onClick={run}><Icon name="refresh" />Try again</Btn>
        </div>
      )}
      {ready && (
        <>
          <div className={styles.asked}><strong>Asked:</strong> {askedLine}</div>
          {state.summary && <div className={styles.summary}><Icon name="auto_awesome" /> {state.summary}</div>}
          {unchanged && <div className={styles.note}>The AI made no changes \u2014 nothing needed to change for that request.</div>}
          {creating ? (
            <div className={styles.cols} style={{ gridTemplateColumns: '1fr' }}>
              <Column heading="New test case" data={state.enhanced} other={EMPTY} accent plain />
            </div>
          ) : (
            <div className={styles.cols}>
              <Column heading="Original" data={state.original} other={state.enhanced} />
              <Column heading="Edited by AI" data={state.enhanced} other={state.original} accent />
            </div>
          )}
          <div className={styles.foot}>
            {creating
              ? 'Add test case puts this scenario into the feature. You can still edit it afterwards.'
              : 'Highlighted lines differ from the other side. Save puts the edited scenario into the editor and applies it.'}
          </div>
        </>
      )}
    </Modal>
  )
}
