import { useState, useEffect } from 'react'
import jsyaml from 'js-yaml'
import styles from './GenerateModal.module.css'
import Btn from './Btn'
import Icon from './Icon'
import { useStickToBottom } from '../hooks/useStickToBottom'

export default function GenerateModal({ open, onClose, onGenerated }) {
  const [spec, setSpec] = useState('')
  const [moduleHints, setModuleHints] = useState('')
  const [phase, setPhase] = useState('input') // 'input' | 'generating' | 'done' | 'error'
  const [progress, setProgress] = useState('')  // streamed text
  const [statusLabel, setStatusLabel] = useState('') // agent phase label (planning, module N/M, ...)
  const [errorMsg, setErrorMsg] = useState('')
  // Auto-scroll the streamed YAML preview — pauses when the user scrolls up
  const { ref: progressRef } = useStickToBottom([progress])

  if (!open) return null

  const reset = () => {
    setPhase('input')
    setProgress('')
    setStatusLabel('')
    setErrorMsg('')
  }

  const handleClose = () => { reset(); onClose() }

  const handleGenerate = async () => {
    if (!spec.trim()) return
    setPhase('generating')
    setProgress('')
    setStatusLabel('Starting…')
    setErrorMsg('')

    let accumulated = ''
    try {
      const resp = await fetch('/api/generate/test-suite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: spec.trim(), moduleHints: moduleHints.trim() }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || resp.statusText)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') {
            setPhase('done')
            break
          }
          if (payload.startsWith('[ERROR]')) {
            throw new Error(payload.slice(8))
          }
          try {
            const parsed = JSON.parse(payload)
            if (typeof parsed === 'string') {
              // Text chunk — append to the preview
              accumulated += parsed
              setProgress(accumulated)
            } else if (parsed && parsed.event === 'status') {
              // Agent phase update — surface in the status line
              if (parsed.label) setStatusLabel(parsed.label)
            }
          } catch { /* skip malformed */ }
        }
      }

      if (accumulated) setPhase('done')
    } catch (e) {
      setErrorMsg(e.message)
      setPhase('error')
    }
  }

  const handleImport = () => {
    try {
      const parsed = jsyaml.load(progress)
      if (!parsed?.modules) throw new Error('Expected { modules: [...] }')
      onGenerated(parsed)
      handleClose()
    } catch (e) {
      setErrorMsg('YAML parse error: ' + e.message)
      setPhase('error')
    }
  }

  return (
    <div className={styles.backdrop} onClick={handleClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            <Icon name="auto_awesome" />
            Generate Test Suite from Spec
          </span>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {phase === 'input' && (
          <div className={styles.body}>
            <div className={styles.field}>
              <label className={styles.label}>
                Application Spec <span className={styles.required}>*</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={10}
                placeholder="Paste your application specification, user stories, feature descriptions, or any text that describes what the application does..."
                value={spec}
                onChange={e => setSpec(e.target.value)}
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>
                Module Hints <span className={styles.optional}>(optional)</span>
              </label>
              <textarea
                className={styles.textarea}
                rows={4}
                placeholder={`Describe the modules you want and their scope, e.g.:\n- Authentication: login, logout, password reset, MFA\n- Account Management: create, update, close accounts\n- Payments: card transactions, refunds, disputes`}
                value={moduleHints}
                onChange={e => setModuleHints(e.target.value)}
              />
            </div>
            <div className={styles.footer}>
              <Btn onClick={handleClose}>Cancel</Btn>
              <Btn variant="primary" disabled={!spec.trim()} onClick={handleGenerate}>
                <Icon name="auto_awesome" />Generate
              </Btn>
            </div>
          </div>
        )}

        {(phase === 'generating' || phase === 'done') && (
          <div className={styles.body}>
            <div className={styles.progressHeader}>
              {phase === 'generating'
                ? <span className={styles.generating}>
                    <Icon name="progress_activity" />
                    {statusLabel || 'Generating test suite…'}
                  </span>
                : <span className={styles.done}><Icon name="check_circle" />Generation complete</span>}
            </div>
            <textarea
              ref={progressRef}
              className={styles.yamlPreview}
              readOnly
              value={progress}
            />
            {phase === 'done' && (
              <div className={styles.footer}>
                <Btn onClick={() => setPhase('input')}>← Back</Btn>
                <Btn variant="primary" onClick={handleImport}>
                  Import into Editor
                </Btn>
              </div>
            )}
            {phase === 'generating' && (
              <div className={styles.footer}>
                <span className={styles.hint}>Please wait…</span>
              </div>
            )}
          </div>
        )}

        {phase === 'error' && (
          <div className={styles.body}>
            <div className={styles.errorBox}><Icon name="error" />{errorMsg}</div>
            <div className={styles.footer}>
              <Btn onClick={reset}>← Try Again</Btn>
              <Btn onClick={handleClose}>Close</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
