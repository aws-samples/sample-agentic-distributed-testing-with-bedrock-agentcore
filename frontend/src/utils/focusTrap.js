// Focus-trap rule for dialogs, kept pure so it can be tested without a DOM.

/**
 * Where Tab should move focus so it stays inside a dialog.
 * items: the dialog's focusable elements in tab order; active: the focused element.
 * Returns the element to focus, or null when the browser's own Tab move stays inside.
 * Focus on the dialog box itself (not in items) or outside it goes to the first/last item.
 */
export function trapTarget(items, active, shift) {
  if (items.length === 0) return null
  const first = items[0], last = items[items.length - 1]
  const i = items.indexOf(active)
  if (i === -1) return shift ? last : first
  if (shift && active === first) return last
  if (!shift && active === last) return first
  return null
}

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
