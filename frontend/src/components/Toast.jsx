import { useEffect, useRef } from 'react'
import Icon from './Icon'
import styles from './Toast.module.css'

// Top-right notification. kind 'error' stays until closed; 'success' auto-dismisses
// after autoDismissMs. Esc closes it. Mount a new one (change `key`) to restart the timer.
export default function Toast({ kind = 'success', onClose, autoDismissMs = 8000, className = '', children }) {
  const isError = kind === 'error'
  const closeRef = useRef(onClose) // latest handler, so a re-render never restarts the timer
  closeRef.current = onClose

  useEffect(() => {
    if (isError) return undefined
    const t = setTimeout(() => closeRef.current(), autoDismissMs)
    return () => clearTimeout(t)
  }, [isError, autoDismissMs])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className={`${styles.toast} ${isError ? styles.error : styles.success}${className ? ' ' + className : ''}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? undefined : 'polite'}
    >
      <Icon name={isError ? 'error' : 'check_circle'} size={18} />
      <div className={styles.message}>{children}</div>
      <button type="button" className={styles.close} onClick={onClose} aria-label="Close notification">
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
