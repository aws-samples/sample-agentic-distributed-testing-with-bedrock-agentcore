// Pure helpers for the Import dialog (ImportModal), kept here so they can be tested.

export const ROWS_SHOWN = 10   // a feature's list collapses after this many rows ("and 23 more")

/**
 * The rows one feature shows in the "Add to suite" preview. Skipped rows come first
 * and are never hidden, so a skip reason is never behind "and N more".
 * f: { add: [{ title }], skip: [{ title, reason }] }
 */
export function previewRows(f, showAll = false) {
  const rows = [...f.skip.map(c => ({ kind: 'skip', ...c })), ...f.add.map(c => ({ kind: 'add', title: c.title }))]
  const shown = showAll ? rows : rows.slice(0, Math.max(ROWS_SHOWN, f.skip.length))
  return { rows: shown, hidden: rows.length - shown.length }
}

/**
 * Why the import must wait for the tester to save, or null. Add to suite checks the
 * file against the SAVED suite; Replace suite would throw the unsaved edits away.
 */
export function unsavedBlock({ mode, dirty }) {
  if (!dirty) return null
  return mode === 'add'
    ? 'You have unsaved changes in the editor. Add to suite checks the file against the saved suite, so they need saving first.'
    : 'You have unsaved changes in the editor. Replace suite would throw them away, so save them first (or Cancel).'
}
