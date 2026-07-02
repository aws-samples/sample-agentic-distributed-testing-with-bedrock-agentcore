import { useState, useEffect, useRef } from 'react'
import styles from './ModuleModal.module.css'
import Btn from './Btn'
import Icon from './Icon'

export default function ModuleModal({ open, onClose, onConfirm, editModule }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const nameRef = useRef(null)

  useEffect(() => {
    if (!open) return
    if (editModule) {
      setName(editModule.name || '')
      setDesc(editModule.description || '')
    } else {
      setName('')
      setDesc('')
    }
    setTimeout(() => nameRef.current?.focus(), 50)
  }, [open, editModule])

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
          <span>{editModule ? 'Edit Module' : 'Add Module'}</span>
          <span style={{ flex: 1 }} />
          <Btn size="sm" onClick={onClose}><Icon name="close" size={14} /></Btn>
        </div>
        <div className={styles.body}>
          <div className={styles.field}>
            <label className={styles.label}>Module Name *</label>
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
            <label className={styles.label}>Description</label>
            <input
              className={styles.input}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Brief description of this module's scope"
            />
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
