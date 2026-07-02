import { useState, useEffect } from 'react'
import jsyaml from 'js-yaml'
import styles from './TcEditor.module.css'
import Btn from './Btn'
import Icon from './Icon'

function toLines(v) {
  if (!v) return ''
  return Array.isArray(v) ? v.join('\n') : v
}

function fromLines(s) {
  return (s || '').split('\n').map(l => l.trim()).filter(Boolean)
}

export default function TcEditor({ tc, onApply, onDelete, readOnly = false }) {
  const [activeTab, setActiveTab] = useState('fields')
  const [title, setTitle] = useState('')
  const [preconditions, setPreconditions] = useState('')
  const [steps, setSteps] = useState('')
  const [expectedResult, setExpectedResult] = useState('')
  const [yamlText, setYamlText] = useState('')

  useEffect(() => {
    if (!tc) return
    setTitle(tc.title || '')
    setPreconditions(toLines(tc.preconditions))
    setSteps(toLines(tc.steps))
    setExpectedResult(toLines(tc.expectedResult))
    setYamlText(jsyaml.dump(tc, { lineWidth: 100, quotingType: '"' }))
    setActiveTab('fields')
  }, [tc?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tc) return null

  const handleApplyFields = () => {
    const updated = {
      ...tc,
      title: title.trim() || tc.title,
      preconditions: fromLines(preconditions),
      steps: fromLines(steps),
      expectedResult: fromLines(expectedResult),
    }
    setYamlText(jsyaml.dump(updated, { lineWidth: 100, quotingType: '"' }))
    onApply(updated)
  }

  const handleSwitchTab = (tab) => {
    if (tab === activeTab) return
    if (activeTab === 'fields') {
      // Sync to yaml
      const updated = {
        ...tc,
        title: title.trim() || tc.title,
        preconditions: fromLines(preconditions),
        steps: fromLines(steps),
        expectedResult: fromLines(expectedResult),
      }
      setYamlText(jsyaml.dump(updated, { lineWidth: 100, quotingType: '"' }))
    }
    setActiveTab(tab)
  }

  const handleApplyYaml = () => {
    try {
      const parsed = jsyaml.load(yamlText)
      if (!parsed) return
      const updated = {
        ...tc,
        title: parsed.title || tc.title,
        preconditions: parsed.preconditions ?? tc.preconditions,
        steps: Array.isArray(parsed.steps) ? parsed.steps : tc.steps,
        expectedResult: parsed.expectedResult ?? tc.expectedResult,
      }
      setTitle(updated.title)
      setPreconditions(toLines(updated.preconditions))
      setSteps(toLines(updated.steps))
      setExpectedResult(toLines(updated.expectedResult))
      onApply(updated)
      setActiveTab('fields')
    } catch (e) {
      alert('YAML parse error: ' + e.message)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.topActions}>
        <Btn variant="primary" disabled={readOnly} onClick={activeTab === 'yaml' ? handleApplyYaml : handleApplyFields}>
          <Icon name="check" />Apply Changes
        </Btn>
        <Btn variant="danger" disabled={readOnly} style={{ marginLeft: 'auto' }} onClick={onDelete}><Icon name="delete" />Delete TC</Btn>
      </div>
      <div className={styles.tabs}>
        <div
          className={`${styles.tab}${activeTab === 'fields' ? ' ' + styles.tabActive : ''}`}
          onClick={() => handleSwitchTab('fields')}
        >
          Fields
        </div>
        <div
          className={`${styles.tab}${activeTab === 'yaml' ? ' ' + styles.tabActive : ''}`}
          onClick={() => handleSwitchTab('yaml')}
        >
          YAML
        </div>
      </div>

      {activeTab === 'fields' ? (
        <>
          <div className={styles.fieldsPane}>
            <div style={{ marginBottom: 14 }}>
              <span className={styles.idBadge}>{tc.id}</span>
            </div>
            <div className={styles.fieldSection}>
              <label className={styles.fieldLabel}>Title *</label>
              <input
                className={styles.fieldInput}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={readOnly}
              />
            </div>
            <div className={styles.fieldSection}>
              <label className={styles.fieldLabel}>Preconditions</label>
              <textarea
                className={`${styles.fieldInput} ${styles.fieldTextarea}`}
                rows={3}
                value={preconditions}
                onChange={(e) => setPreconditions(e.target.value)}
                placeholder="One condition per line"
                disabled={readOnly}
              />
              <div className={styles.hint}>One condition per line</div>
            </div>
            <div className={styles.fieldSection}>
              <label className={styles.fieldLabel}>Steps</label>
              <textarea
                className={`${styles.fieldInput} ${styles.fieldTextarea}`}
                rows={7}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                disabled={readOnly}
              />
              <div className={styles.hint}>One step per line</div>
            </div>
            <div className={styles.fieldSection}>
              <label className={styles.fieldLabel}>Expected Result</label>
              <textarea
                className={`${styles.fieldInput} ${styles.fieldTextarea}`}
                rows={3}
                value={expectedResult}
                onChange={(e) => setExpectedResult(e.target.value)}
                placeholder="One expected result per line"
                disabled={readOnly}
              />
              <div className={styles.hint}>One expected result per line</div>
            </div>
          </div>
        </>
      ) : (
        <div className={styles.yamlPane}>
          <div className={styles.yamlToolbar}>
            <span className={styles.yamlHint}>
              Editing YAML for <strong style={{ color: 'var(--accent)' }}>{tc.id}</strong>
            </span>
          </div>
          <textarea
            className={styles.yamlEditor}
            value={yamlText}
            onChange={(e) => setYamlText(e.target.value)}
            spellCheck={false}
            disabled={readOnly}
          />
        </div>
      )}
    </div>
  )
}
