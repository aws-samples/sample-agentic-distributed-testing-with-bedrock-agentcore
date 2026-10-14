// Editing rules for a plain <textarea> used as a small code editor (the Gherkin tab).
//
// Everything here is pure: each function takes the text and the selection and
// returns ONE replacement { from, to, text, selStart, selEnd } — "replace
// value[from..to) with `text`, then select selStart..selEnd". Keeping it as a
// single replacement lets the component apply it through the browser's own
// editing command, so Ctrl+Z still undoes it.

export const INDENT = '  '   // Gherkin convention: two spaces per level

const lineStartOf = (value, pos) => value.lastIndexOf('\n', pos - 1) + 1

function lineEndOf(value, pos) {
  const i = value.indexOf('\n', pos)
  return i === -1 ? value.length : i
}

/** Leading whitespace of the line containing `pos`. */
function leadingWhitespace(value, pos) {
  const start = lineStartOf(value, pos)
  return /^[ \t]*/.exec(value.slice(start, lineEndOf(value, pos)))[0]
}

/**
 * Tab / Shift+Tab.
 *  - Tab, nothing selected: insert one indent at the cursor.
 *  - Tab, something selected: indent every line the selection touches (never
 *    replaces the selected text, so a stray Tab can't delete anything).
 *  - Shift+Tab: remove one indent (or a tab, or a single space) from the start
 *    of the current / selected lines.
 */
export function tabEdit(value, start, end, shift = false) {
  const hasSelection = end > start

  if (!shift && !hasSelection) {
    return { from: start, to: start, text: INDENT, selStart: start + INDENT.length, selEnd: start + INDENT.length }
  }

  // The lines to change. A selection that ends at column 0 of a line doesn't
  // include that last line (matches what editors do).
  const firstLine = lineStartOf(value, start)
  const lastPos = hasSelection && end > firstLine && value[end - 1] === '\n' ? end - 1 : end
  const blockEnd = lineEndOf(value, lastPos)
  const lines = value.slice(firstLine, blockEnd).split('\n')

  let removedFirst = 0, addedFirst = 0, delta = 0
  const out = lines.map((line, i) => {
    if (!shift) {
      if (line === '') return line                      // don't pad blank lines
      if (i === 0) addedFirst = INDENT.length
      delta += INDENT.length
      return INDENT + line
    }
    let n = 0
    if (line.startsWith(INDENT)) n = INDENT.length
    else if (line.startsWith('\t')) n = 1
    else if (line.startsWith(' ')) n = 1
    if (i === 0) removedFirst = n
    delta -= n
    return line.slice(n)
  })

  const text = out.join('\n')
  if (!hasSelection) {
    // Shift+Tab with just a cursor: keep it where it was, relative to the text.
    const col = Math.max(firstLine, start - removedFirst)
    return { from: firstLine, to: blockEnd, text, selStart: col, selEnd: col }
  }
  // Keep the same text selected after the change.
  const selStart = Math.max(firstLine, start + (shift ? -removedFirst : addedFirst))
  const selEnd = Math.max(selStart, end + delta)
  return { from: firstLine, to: blockEnd, text, selStart, selEnd }
}

/**
 * Enter. Aware of the "Given: / - step" layout:
 *   - after a "- step", the new line starts another "- " at the same indent
 *   - on an empty "- ", Enter ends the list (removes the dash)
 *   - at the end of a "Given:" / "When:" / "Then:" header, the new line is an
 *     indented "- " ready for the first step
 *   - anywhere else, the new line keeps the current indentation
 * Returns one replacement, like the other helpers here.
 */
export function enterEdit(value, start, end) {
  const lineStart = lineStartOf(value, start)
  const lineEnd = lineEndOf(value, start)
  const wholeLine = value.slice(lineStart, lineEnd)
  const before = value.slice(lineStart, start)

  // An empty bullet: Enter ends the list rather than adding another dash.
  if (start === end && start === lineEnd && /^\s*[-*]\s*$/.test(wholeLine)) {
    return { from: lineStart, to: lineEnd, text: '', selStart: lineStart, selEnd: lineStart }
  }

  // Cursor is inside a bullet's text: carry the bullet (and its indent) to the new line.
  const bullet = /^(\s*)([-*])\s+/.exec(before)
  if (bullet) {
    const text = '\n' + bullet[1] + bullet[2] + ' '
    return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length }
  }

  // Right after a "Given:" / "When:" / "Then:" header: open the list.
  const header = /^(\s*)(?:Given|When|Then|Background)\s*:\s*$/i.exec(before)
  if (header && start === lineEnd) {
    const text = '\n' + header[1] + INDENT + '- '
    return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length }
  }

  // Default: keep the indentation to the LEFT of the cursor, so pressing Enter in
  // the middle of the indent doesn't duplicate it.
  const ws = leadingWhitespace(value, start)
  const carried = ws.slice(0, Math.max(0, Math.min(ws.length, start - lineStart)))
  const text = '\n' + carried
  return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length }
}
