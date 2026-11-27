// Log entries carry an ISO timestamp from the server; show it in the viewer's own locale and
// timezone. Entries archived before that change hold a preformatted string: show it as is.
export function formatLogTs(ts) {
  if (typeof ts === 'string' && /^\d{4}-\d\d-\d\dT/.test(ts)) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString()
  }
  return ts
}
