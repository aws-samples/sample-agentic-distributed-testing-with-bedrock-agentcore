import { useState, useEffect, useRef } from 'react'
import styles from './FeatureModal.module.css'
import Btn from './Btn'
import Icon from './Icon'

export default function FeatureModal({ open, onClose, onConfirm, editFeature }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const nameRef = useRef(null)

  useEffect(() => {
    if (!open) return
    if (editFeature) {
      setName(editFeature.name || '')
      setDesc(editFeature.description || '')
    } else {
      setName('')
      setDesc('')
    }
    setTimeout(() => nameRef.current?.focus(), 50)
  }, [open, editFeature])

  if (!open) return null

  const handleConfirm = () => {
    const trimmed = name.trim()
    if (!trimmed) { nameRef.current?.focus(); return }
    onConfirm({ name: trimmed, description: desc.trim() || undefined })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className={styles.backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span>{editFeature ? 'Edit Feature' : 'Add Feature'}</span>
          <span style={{ flex: 1 }} />
          <Btn size="sm" onClick={onClose}><Icon name="close" size={14} /></Btn>
        </div>
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Feature Name *</label>
            <input
              ref={nameRef}
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Authentication"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Background</label>
            <textarea
              className={styles.input}
              rows={4}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
              placeholder={'Shared setup that applies before every scenario in this feature, e.g.\nGiven the app is running and I am signed in as a customer\nAnd I have at least one credit card account'}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Optional. Plain language is fine. The agent works through this before each scenario, so you don't repeat it in every test case.
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleConfirm}>Save</Btn>
        </div>
      </div>
    </div>
  )
}
