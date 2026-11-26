// Wording for a feature's pause, shared by the browser cell and FocusModal. Pure (no React) so the
// backend test run can import it. `info` is { state: 'pausing' | 'paused', after, caseStartedAt, heldSince }.
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// "Pausing after TC003 · running 2:41" while the case is still going; "Paused 0:12" once it holds.
export function pauseLabel(info, now) {
  if (!info) return ''
  if (info.state === 'paused') return info.heldSince ? `Paused ${formatElapsed(now - Date.parse(info.heldSince))}` : 'Paused'
  const running = info.caseStartedAt ? ` · running ${formatElapsed(now - Date.parse(info.caseStartedAt))}` : ''
  return `Pausing after ${info.after || 'the current case'}${running}`
}
