export default function Btn({ children, variant = '', size = '', disabled, onClick, title, href, style, type }) {
  const cls = ['btn', variant && `btn-${variant}`, size && `btn-${size}`].filter(Boolean).join(' ')
  if (href) {
    return (
      <a href={href} className={cls} style={style} title={title}>
        {children}
      </a>
    )
  }
  return (
    <button
      className={cls}
      disabled={disabled}
      onClick={onClick}
      title={title}
      style={style}
      type={type || 'button'}
    >
      {children}
    </button>
  )
}
