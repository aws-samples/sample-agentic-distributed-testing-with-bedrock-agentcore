import { useState, useEffect } from 'react'
import Modal from './Modal'
import Btn from './Btn'
import Icon from './Icon'
import FileDrop from './FileDrop'
import styles from './ImportModal.module.css'
import { readTextFile } from '../utils/readFile'
import { parseSuiteYaml } from '../utils/importSuite'
import { IMPORT_TEMPLATE_YAML, downloadText } from '../utils/samples'

/**
 * Import a test suite from a YAML file. Step 1: get the template if needed and
 * pick a file. Step 2 (automatic): the file is checked and summarised; only the
 * "Import" button changes the suite.
 */
export default function ImportModal({ open, onClose, onImport, existingCount }) {
  const [picked, setPicked] = useState(null)   // { name, doc, summary }
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setPicked(null); setError('') } }, [open])

  const onFile = async (file) => {
    setError(''); setPicked(null)
    try {
      const { name, text } = await readTextFile(file, ['.yaml', '.yml'])
      const { doc, summary } = parseSuiteYaml(text)
      setPicked({ name, doc, summary })
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import test suite"
      width="min(560px, 94vw)"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!picked} onClick={() => onImport(picked.doc, picked.name)}>
            <Icon name="upload_file" />Import{picked ? ` ${picked.summary.cases} test case${picked.summary.cases === 1 ? '' : 's'}` : ''}
          </Btn>
        </>
      }
    >
      <div className={styles.body}>
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
        {picked && (
          <div className={styles.ok}>
            <div><Icon name="check_circle" size={16} /> <strong>{picked.summary.features}</strong> feature{picked.summary.features === 1 ? '' : 's'} and <strong>{picked.summary.cases}</strong> test case{picked.summary.cases === 1 ? '' : 's'} found</div>
            <div className={styles.names}>{picked.summary.names.slice(0, 6).join(' · ')}{picked.summary.names.length > 6 ? ` · +${picked.summary.names.length - 6} more` : ''}</div>
            {existingCount > 0 && (
              <div className={styles.replace}><Icon name="warning" size={16} /> Importing replaces your current {existingCount} feature{existingCount === 1 ? '' : 's'} and all their test cases. Export first if you want a backup.</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
