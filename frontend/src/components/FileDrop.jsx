import { useRef, useState } from 'react'
import Icon from './Icon'
import styles from './FileDrop.module.css'

/**
 * A click-or-drop file target. It only reports the chosen File; reading and
 * validating it is left to the caller (see utils/readFile.js).
 */
export default function FileDrop({ accept, onFile, disabled, label = 'Choose a file or drop it here', hint, fileName }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)

  const pick = (files) => { const f = files && files[0]; if (f) onFile(f) }

  return (
    <div
      className={`${styles.drop} ${over ? styles.over : ''} ${disabled ? styles.disabled : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files) }}
    >
      <Icon name={fileName ? 'description' : 'upload_file'} size={26} />
      <div className={styles.label}>{fileName || label}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
      <input
        ref={input}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
        disabled={disabled}
      />
    </div>
  )
}
