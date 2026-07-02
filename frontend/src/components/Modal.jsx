import styles from './Modal.module.css'
import Icon from './Icon'

export default function Modal({ open, onClose, title, children, footer, width }) {
  if (!open) return null
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.box}
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span>{title}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  )
}
