// Helpers for hand-written test cases: "does it have steps" and "name a copy".

export const TITLE_MAX = 300   // same limit as the backend (CASE_LIMITS.title)

// Why a scenario title cannot be applied, or '' when it can.
export function titleProblem(title) {
  const t = String(title ?? '').trim()
  if (!t) return 'Scenario title is required'
  return t.length > TITLE_MAX ? `Scenario title is longer than ${TITLE_MAX} characters` : ''
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])

// True when Given, When or Then holds at least one step with text in it.
// Rows that are empty or only spaces do not count.
export function hasSteps(tc) {
  return ['given', 'when', 'then'].some(k => asList(tc?.[k]).some(s => typeof s === 'string' && s.trim() !== ''))
}

const COPY_PREFIX = 'Copy of '

// Title for a copy of `title`, not in `taken`: "Copy of X", then "Copy of X (2)", "(3)", ...
// A copy of a copy names the same original ("Copy of Copy of X" never appears).
// A trailing "(N)" is dropped only from titles that start with "Copy of ", so a
// title the user wrote as "Login (2)" is kept as it is.
export function copyTitle(title, taken) {
  let root = String(title ?? '').trim()
  if (root.startsWith(COPY_PREFIX)) {
    while (root.startsWith(COPY_PREFIX)) root = root.slice(COPY_PREFIX.length).trimStart()
    root = root.replace(/ \(\d+\)$/, '')
  }
  const used = new Set(taken)
  const fit = (suffix) => COPY_PREFIX + root.slice(0, Math.max(1, TITLE_MAX - COPY_PREFIX.length - suffix.length)) + suffix
  let candidate = fit('')
  for (let n = 2; used.has(candidate); n++) candidate = fit(` (${n})`)
  return candidate
}
