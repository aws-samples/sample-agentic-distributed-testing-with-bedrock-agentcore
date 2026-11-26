import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import FileDrop from './FileDrop'
import styles from './ImportModal.module.css'
import { readTextFile } from '../utils/readFile'
import { parseSuiteYaml } from '../utils/importSuite'
import { IMPORT_TEMPLATE_YAML, downloadText } from '../utils/samples'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const ROWS_SHOWN = 10   // a feature's list collapses after this many rows ("and 23 more")

/**
 * Import a test suite from a YAML file. Two modes:
 * - "Add to suite" (default): the backend checks the file against the saved suite
 *   and returns a preview (onPreviewAdd); nothing is written until "Add to suite" is clicked.
 * - "Replace suite": the file replaces every feature and test case (onReplace).
 */
export default function ImportModal({ open, onClose, onReplace, onPreviewAdd, onConfirmAdd, existingCount }) {
  const [mode, setMode] = useState('add')
  const [picked, setPicked] = useState(null)     // { name, text, doc, summary }
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)   // the backend's dry-run answer
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (open) { setMode('add'); setPicked(null); setError(''); setPreview(null) } }, [open])

  // Ask for a fresh preview whenever a file is picked in Add mode.
  useEffect(() => {
    if (!open || mode !== 'add' || !picked) return
    let stale = false
    setPreview(null); setBusy(true); setError('')
    onPreviewAdd(picked.text)
      .then(p => { if (!stale) setPreview(p) })
      .catch(e => { if (!stale) setError(e.message) })
      .finally(() => { if (!stale) setBusy(false) })
    return () => { stale = true }
  }, [open, mode, picked]) // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (file) => {
    setError(''); setPicked(null); setPreview(null)
    try {
      const { name, text } = await readTextFile(file, ['.yaml', '.yml'])
      const { doc, summary } = parseSuiteYaml(text)
      setPicked({ name, text, doc, summary })
    } catch (e) {
      setError(e.message)
    }
  }

  const confirmAdd = async () => {
    setBusy(true); setError('')
    try { await onConfirmAdd(picked.text, picked.name) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const s = preview?.summary
  const nothingToAdd = s && s.casesAdded === 0 && s.featuresAdded === 0
  const footer = (
    <>
      <Btn onClick={onClose}>Cancel</Btn>
      {mode === 'add' ? (
        <Btn variant="primary" disabled={!preview || nothingToAdd || busy} onClick={confirmAdd}>
          <Icon name="upload" />Add to suite
        </Btn>
      ) : (
        <Btn variant="primary" disabled={!picked} onClick={() => onReplace(picked.doc, picked.name)}>
          <Icon name="upload_file" />Replace suite{picked ? ` with ${plural(picked.summary.cases, 'test case')}` : ''}
        </Btn>
      )}
    </>
  )

  return (
    <Modal open={open} onClose={onClose} title="Import test suite" width="min(560px, 94vw)" footer={footer}>
      <div className={styles.body}>
        <div className={styles.modes} role="radiogroup" aria-label="How to import">
          <ModeChoice
            checked={mode === 'add'} onSelect={() => setMode('add')} icon="playlist_add"
            title="Add to suite" sub="Keeps everything you have. Shows what will be added first."
          />
          <ModeChoice
            checked={mode === 'replace'} onSelect={() => setMode('replace')} icon="swap_horiz" warn
            title="Replace suite" sub={`Removes your current ${plural(existingCount, 'feature')} and their test cases.`}
          />
        </div>

        <div className={styles.step}>
          <div className={styles.stepNum}>1</div>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Start from the template <span>(optional)</span></div>
            <div className={styles.sub}>A small YAML file with one feature, a Background and two scenarios, with the format explained in comments.</div>
            <Btn size="sm" onClick={() => downloadText('test-suite-template.yaml', IMPORT_TEMPLATE_YAML, 'text/yaml')}>
              <Icon name="download" />Download template
            </Btn>
          </div>
        </div>

        <div className={styles.step}>
          <div className={styles.stepNum}>2</div>
          <div className={styles.stepBody}>
            <div className={styles.stepTitle}>Upload your file</div>
            <FileDrop
              accept=".yaml,.yml"
              onFile={onFile}
              fileName={picked?.name}
              label="Choose a .yaml file or drop it here"
              hint={picked ? 'Click to choose a different file' : 'Up to 1 MB'}
            />
          </div>
        </div>

        {error && (
          <div className={styles.error} role="alert"><Icon name="error" size={16} /><div className={styles.errorText}>{error}</div></div>
        )}

        {mode === 'add' && picked && busy && !preview && <div className={styles.sub}>Checking the file against your current suite…</div>}
        {mode === 'add' && picked && preview && <AddPreview fileName={picked.name} found={picked.summary.cases} preview={preview} />}

        {mode === 'replace' && picked && (
          <div className={styles.ok}>
            <div><Icon name="check_circle" size={16} /> <strong>{picked.summary.features}</strong> feature{picked.summary.features === 1 ? '' : 's'} and <strong>{picked.summary.cases}</strong> test case{picked.summary.cases === 1 ? '' : 's'} found</div>
            <div className={styles.names}>{picked.summary.names.slice(0, 6).join(' · ')}{picked.summary.names.length > 6 ? ` · +${picked.summary.names.length - 6} more` : ''}</div>
            {existingCount > 0 && (
              <div className={styles.replace}><Icon name="warning" size={16} /> Replacing removes your current {plural(existingCount, 'feature')} and all their test cases. Export first if you want a backup.</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ModeChoice({ checked, onSelect, icon, title, sub, warn }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect}
      className={`${styles.mode} ${checked ? styles.modeOn : ''} ${warn ? styles.modeWarn : ''}`}>
      <span className={styles.radio} aria-hidden="true" />
      <span className={styles.modeText}>
        <span className={styles.modeTitle}><Icon name={icon} size={16} />{title}</span>
        <span className={styles.modeSub}>{sub}</span>
      </span>
    </button>
  )
}

// Layout B (issue #67): counts at the top, then each feature with what is added and what is skipped.
function AddPreview({ fileName, found, preview }) {
  const { summary: s, features } = preview
  return (
    <div className={styles.preview}>
      <div className={styles.file}>
        <Icon name="description" size={16} />
        <span><b>{fileName}</b> · {plural(found, 'test case')} found, checked against your current suite</span>
      </div>
      <div className={styles.chips}>
        <span className={styles.chip}>{plural(s.features, 'feature')}</span>
        <span className={`${styles.chip} ${styles.chipMuted}`}>{s.featuresAdded} added · {s.featuresMerged} merged</span>
        <span className={`${styles.chip} ${styles.chipGreen}`}>{plural(s.casesAdded, 'case')} added</span>
        <span className={`${styles.chip} ${styles.chipYellow}`}>{s.casesSkipped} skipped</span>
      </div>
      {s.casesAdded === 0 && s.featuresAdded === 0 && (
        <div className={styles.replace}><Icon name="info" size={16} /> Nothing to add: everything in this file is already in your suite.</div>
      )}
      {features.map(f => <FeatureGroup key={f.name} f={f} />)}
    </div>
  )
}

function FeatureGroup({ f }) {
  const [showAll, setShowAll] = useState(false)
  const rows = [...f.add.map(c => ({ kind: 'add', title: c.title })), ...f.skip.map(c => ({ kind: 'skip', ...c }))]
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN)
  const hidden = rows.length - shown.length
  return (
    <div className={styles.grp}>
      <div className={styles.gh}>
        <span className={styles.ghName}>{f.name}</span>
        <span className={`${styles.tag} ${f.status === 'merged' ? styles.tagMerged : styles.tagNew}`}>
          {f.status === 'merged' ? 'merged into existing' : 'new feature'}
        </span>
        <span className={styles.cnt}>{f.add.length} added{f.skip.length ? ` · ${f.skip.length} skipped` : ''}</span>
      </div>
      {f.backgroundDiffers && (
        <div className={styles.bgNote}><Icon name="warning" size={14} /> Your file has a different Background. It was not applied: the existing Background is kept.</div>
      )}
      {shown.map((r, i) => (
        <div key={i} className={`${styles.row} ${r.kind === 'add' ? styles.rowAdd : styles.rowSkip}`}>
          <span className={styles.sign}>{r.kind === 'add' ? '+' : '–'}</span>
          <span className={styles.rowTitle}>{r.title}</span>
          {r.kind === 'skip' && <span className={styles.why}>skipped: {r.reason}</span>}
        </div>
      ))}
      {hidden > 0 && (
        <button type="button" className={`${styles.row} ${styles.more}`} onClick={() => setShowAll(true)}>
          <span className={styles.sign} />and {hidden} more
        </button>
      )}
      {rows.length === 0 && <div className={`${styles.row} ${styles.more}`}><span className={styles.sign} />No test cases in this feature</div>}
    </div>
  )
}
