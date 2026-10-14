import { useState, useEffect, useRef } from 'react'
import styles from './FeatureModal.module.css'
import Btn from './Btn'
import Icon from './Icon'
import FileDrop from './FileDrop'
import { readTextFile } from '../utils/readFile'
import { SAMPLE_SPEC, downloadText } from '../utils/samples'
import { draftFeature } from '../utils/draftFeature'
import { toRows } from '../utils/gherkin'

const SPEC_EXTENSIONS = ['.txt', '.md', '.markdown', '.text']
const MAX_SPEC_CHARS = 60000   // keep in step with the backend limit

// "Login" -> "Login (2)" when "Login" is taken.
function uniqueName(base, taken) {
  let name = base || 'New feature', n = 2
  while (taken.includes(name)) name = `${base} (${n++})`
  return name
}

/**
 * Add or edit a feature.
 *
 * Adding is one flow with an optional shortcut: fill in the name and Background
 * yourself, or open "Draft test cases from a spec" to have the AI fill in what
 * you haven't typed and propose the test cases. Either way a single "Add feature"
 * button adds the feature (with any drafted cases you kept).
 *
 * `existingNames` are the other features' names, for duplicate checking.
 * onConfirm({ name, description, testCases? }) — testCases only when adding.
 */
export default function FeatureModal({ open, onClose, onConfirm, onDelete, editFeature, existingNames = [] }) {
  const adding = !editFeature
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Drafting from a spec (add mode only)
  const [specOpen, setSpecOpen] = useState(false)
  const [spec, setSpec] = useState('')
  const [specFile, setSpecFile] = useState('')
  const [fileError, setFileError] = useState('')
  const [showSample, setShowSample] = useState(false)
  const [gen, setGen] = useState({ status: 'idle' })       // idle | loading | error
  const [cases, setCases] = useState([])                   // drafted test cases being reviewed
  const [openCase, setOpenCase] = useState(null)
  const [auto, setAuto] = useState({ name: '', desc: '' }) // what the AI last filled in, so we never overwrite the user's own edits
  const nameRef = useRef(null)
  const abortRef = useRef(null)
  const reqRef = useRef(0)

  const cancelDraft = () => { abortRef.current?.abort(); abortRef.current = null; reqRef.current++ }

  useEffect(() => {
    cancelDraft()
    if (!open) return
    setConfirmingDelete(false)
    setName(editFeature?.name || '')
    setDesc(editFeature?.description || '')
    setSpecOpen(false); setSpec(''); setSpecFile(''); setFileError(''); setShowSample(false)
    setGen({ status: 'idle' }); setCases([]); setOpenCase(null); setAuto({ name: '', desc: '' })
    const t = setTimeout(() => nameRef.current?.focus(), 50)
    return () => { clearTimeout(t); cancelDraft() }
  }, [open, editFeature])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const loading = gen.status === 'loading'
  const caseCount = (editFeature?.testCases || []).length
  const trimmed = name.trim()
  const duplicate = !!trimmed && existingNames.includes(trimmed)
  const tooLong = spec.length > MAX_SPEC_CHARS
  const canDraft = spec.trim().length > 0 && !tooLong && !loading

  const onSpecFile = async (file) => {
    setFileError('')
    try {
      const { name: fileName, text } = await readTextFile(file, SPEC_EXTENSIONS)
      setSpec(text); setSpecFile(fileName)
    } catch (e) { setFileError(e.message) }
  }

  const draft = async () => {
    if (!canDraft) return
    cancelDraft()
    const ac = new AbortController()
    abortRef.current = ac
    const mine = ++reqRef.current
    setGen({ status: 'loading' })
    try {
      // A name the user typed steers the AI; one it filled in last time does not.
      const typed = trimmed && trimmed !== auto.name ? trimmed : ''
      const f = await draftFeature({ spec: spec.trim(), featureName: typed, signal: ac.signal })
      if (mine !== reqRef.current) return
      const next = { ...auto }
      if (!trimmed || trimmed === auto.name) { next.name = uniqueName(f.name, existingNames); setName(next.name) }
      if (!desc.trim() || desc.trim() === auto.desc) { next.desc = f.description; setDesc(f.description) }
      setAuto(next)
      setCases(f.testCases)
      setOpenCase(null)
      setGen({ status: 'idle' })
      setSpecOpen(false)
    } catch (e) {
      if (e.name === 'AbortError' || mine !== reqRef.current) return
      setGen({ status: 'error', error: e.message })
    }
  }

  const stopDraft = () => { cancelDraft(); setGen({ status: 'idle' }) }

  const handleConfirm = () => {
    if (!trimmed || duplicate || loading) { nameRef.current?.focus(); return }
    onConfirm({ name: trimmed, description: desc.trim() || undefined, ...(adding ? { testCases: cases } : {}) })
  }

  const onModalKeyDown = (e) => {
    if (e.key !== 'Escape') return
    if (confirmingDelete) setConfirmingDelete(false)
    else onClose()
  }

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`${styles.modal} ${adding ? styles.modalWide : ''}`} onKeyDown={onModalKeyDown}>
        <div className={styles.header}>
          <span>{adding ? 'Add feature' : 'Edit feature'}</span>
          <span style={{ flex: 1 }} />
          <Btn size="sm" onClick={onClose} title="Close"><Icon name="close" size={14} /></Btn>
        </div>

        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Feature name *</label>
            <input
              ref={nameRef}
              className={`${styles.input} ${duplicate ? styles.inputBad : ''}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
              placeholder="e.g. Authentication"
              disabled={loading}
              aria-invalid={duplicate}
            />
            {duplicate && <div className={styles.fieldError}><Icon name="error" size={14} />A feature with this name already exists.</div>}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Background <span className={styles.optional}>(optional)</span></label>
            <textarea
              className={styles.input}
              rows={adding ? 3 : 4}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={'Shared setup that applies before every scenario in this feature, e.g.\nGiven the app is running and I am signed in as a customer\nAnd I have at least one credit card account'}
              disabled={loading}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div className={styles.help}>
              Plain language is fine. The agent works through this before each scenario, so you don't repeat it in every test case.
            </div>
          </div>

          {adding && (
            <div className={styles.field}>
              <label className={styles.label}>Test cases</label>

              {cases.length > 0 && (
                <div className={styles.cases}>
                  <div className={styles.casesHead}>
                    <span><strong>{cases.length}</strong> test case{cases.length === 1 ? '' : 's'} drafted — remove any you don't want</span>
                    <span className={styles.casesActions}>
                      <button type="button" className={styles.linkBtn} onClick={() => setSpecOpen(true)} disabled={loading}>Redo from a spec</button>
                      <button type="button" className={styles.linkBtn} onClick={() => { setCases([]); setOpenCase(null) }} disabled={loading}>Discard all</button>
                    </span>
                  </div>
                  <ul className={styles.caseList}>
                    {cases.map((tc, i) => (
                      <li key={i} className={styles.caseItem}>
                        <div className={styles.caseRow}>
                          <button type="button" className={styles.caseTitle} onClick={() => setOpenCase(openCase === i ? null : i)} aria-expanded={openCase === i}>
                            <Icon name={openCase === i ? 'expand_more' : 'chevron_right'} size={16} />
                            <span>{tc.title}</span>
                          </button>
                          <button type="button" className={styles.iconBtn} title="Remove this test case" aria-label={`Remove ${tc.title}`}
                            onClick={() => { setCases(cs => cs.filter((_, j) => j !== i)); setOpenCase(null) }} disabled={loading}>
                            <Icon name="close" size={14} />
                          </button>
                        </div>
                        {openCase === i && (
                          <div className={styles.gherkin}>
                            {toRows(tc, { omitEmpty: true }).filter(r => r.kind !== 'scenario').map((r, k) => (
                              <div key={k} className={r.kind === 'step' ? styles.gStep : undefined}>
                                <span className={styles.kw}>{r.kw}</span>{r.text ? ' ' + r.text : ''}
                              </div>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {cases.length === 0 && !specOpen && (
                <button type="button" className={styles.draftCard} onClick={() => setSpecOpen(true)}>
                  <Icon name="auto_awesome" size={22} />
                  <span className={styles.draftText}>
                    <span className={styles.draftTitle}>Draft test cases from a spec</span>
                    <span className={styles.draftSub}>Upload or paste a user story or requirements. The AI fills in the name, Background and test cases for you to review.</span>
                  </span>
                  <Icon name="chevron_right" size={18} />
                </button>
              )}
              {cases.length === 0 && !specOpen && (
                <div className={styles.help}>Or skip this and add test cases later with the <strong>+</strong> on the feature.</div>
              )}

              {specOpen && (
                <div className={styles.specPanel}>
                  {loading ? (
                    <div className={styles.working} role="status" aria-live="polite">
                      <span className={styles.spinner}><Icon name="progress_activity" size={26} /></span>
                      <div className={styles.workingText}>Reading the spec and drafting test cases…</div>
                      <div className={styles.help}>This usually takes 10–30 seconds.</div>
                      <Btn size="sm" onClick={stopDraft}>Stop</Btn>
                    </div>
                  ) : (
                    <>
                      <FileDrop
                        accept={SPEC_EXTENSIONS.join(',')}
                        onFile={onSpecFile}
                        fileName={specFile}
                        label="Upload a spec file (.md or .txt), or drop it here"
                        hint={specFile ? 'Loaded below — click to choose a different file' : 'Or type / paste it below. Up to 1 MB.'}
                      />
                      {fileError && <div className={styles.fieldError} role="alert"><Icon name="error" size={14} />{fileError}</div>}
                      <textarea
                        className={styles.input}
                        rows={6}
                        placeholder="Paste your spec here, or upload a file above…"
                        value={spec}
                        onChange={e => { setSpec(e.target.value); setSpecFile('') }}
                        style={{ resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <div className={`${styles.count} ${tooLong ? styles.countOver : ''}`}>
                        {spec.length.toLocaleString()} / {MAX_SPEC_CHARS.toLocaleString()} characters{tooLong ? ' — too long, trim it to the part you want tests for' : ''}
                      </div>

                      <button type="button" className={styles.sampleToggle} onClick={() => setShowSample(s => !s)} aria-expanded={showSample}>
                        <Icon name={showSample ? 'expand_more' : 'chevron_right'} size={16} />
                        What does a good spec look like?
                      </button>
                      {showSample && (
                        <div className={styles.sampleBody}>
                          <div className={styles.help}>A user story with acceptance criteria works well. The more concrete the criteria (exact messages, limits, rules), the sharper the test cases. Keep it to one area.</div>
                          <pre className={styles.samplePre}>{SAMPLE_SPEC}</pre>
                          <div className={styles.specActions}>
                            <Btn size="sm" onClick={() => { setSpec(SAMPLE_SPEC); setSpecFile('') }}><Icon name="content_paste" />Use this example</Btn>
                            <Btn size="sm" onClick={() => downloadText('sample-spec.md', SAMPLE_SPEC, 'text/markdown')}><Icon name="download" />Download as .md</Btn>
                          </div>
                        </div>
                      )}

                      {gen.status === 'error' && <div className={styles.errorBox} role="alert"><Icon name="error" size={16} />{gen.error}</div>}

                      <div className={styles.specFooter}>
                        <Btn size="sm" onClick={() => { setSpecOpen(false); setGen({ status: 'idle' }) }}>Never mind</Btn>
                        <Btn size="sm" variant="primary" disabled={!canDraft} onClick={draft}><Icon name="auto_awesome" />Draft with AI</Btn>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {confirmingDelete ? (
          <>
            <div className={styles.deleteWarn} role="alert">
              <Icon name="warning" size={16} />
              <div>
                Delete <strong>{editFeature.name}</strong> and {caseCount === 0 ? 'its' : <>all <strong>{caseCount}</strong></>} test case{caseCount === 1 ? '' : 's'}?
                This can't be undone.
              </div>
            </div>
            <div className={styles.footer}>
              <Btn onClick={() => setConfirmingDelete(false)}>Keep it</Btn>
              <Btn variant="danger" onClick={onDelete}><Icon name="delete" />Yes, delete feature</Btn>
            </div>
          </>
        ) : (
          <div className={styles.footer}>
            {editFeature && onDelete && (
              <Btn variant="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirmingDelete(true)}>
                <Icon name="delete" />Delete
              </Btn>
            )}
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" disabled={!trimmed || duplicate || loading} onClick={handleConfirm}>
              {adding
                ? (cases.length > 0 ? `Add feature with ${cases.length} test case${cases.length === 1 ? '' : 's'}` : 'Add feature')
                : 'Save'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  )
}
