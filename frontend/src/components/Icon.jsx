export default function Icon({ name, size = 16 }) {
  return (
    <span
      className="material-symbols-rounded"
      style={{ fontSize: size, lineHeight: 1, userSelect: 'none', flexShrink: 0 }}
      aria-hidden="true"
    >
      {name}
    </span>
  )
}
