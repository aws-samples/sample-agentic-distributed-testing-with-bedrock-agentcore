import { useEffect, useId, useRef } from 'react'
import styles from './Modal.module.css'
import Icon from './Icon'
import { trapTarget, FOCUSABLE } from '../utils/focusTrap'

// closeOnEscape and trapFocus are opt-in so dialogs holding typed input (AI drafts, settings) keep
// their current behaviour; a click outside still closes every dialog as before.
export default function Modal({ open, onClose, title, children, footer, width, closeOnEscape = false, trapFocus = false }) {
  const titleId = useId()
  const boxRef = useRef(null)
  // Move focus into the dialog on open and give it back to the opener on close.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    boxRef.current?.focus()
    return () => { if (opener instanceof HTMLElement) opener.focus() }
  }, [open])
  if (!open) return null
  const onKeyDown = (e) => {
    if (closeOnEscape && e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (trapFocus && e.key === 'Tab') {
      const items = [...boxRef.current.querySelectorAll(FOCUSABLE)]
      const to = trapTarget(items, document.activeElement, e.shiftKey)
      if (to) { e.preventDefault(); to.focus() }
    }
  }
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={styles.box}
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span id={titleId}>{title}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  )
}
