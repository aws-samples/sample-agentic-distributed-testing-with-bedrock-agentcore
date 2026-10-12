// Standard Gherkin <-> the stored test case shape { title, given[], when[], then[] }.
//
// Storage stays three arrays, so And/But lines fold into whichever of
// Given/When/Then came before them, and the first line of each group is
// rendered with its keyword and the rest as "And". One test case = one
// Scenario; a Background (if pasted in) is merged into Given.

const SECTIONS = [['given', 'Given'], ['when', 'When'], ['then', 'Then']]
const STEP_RE = /^(Given|When|Then|And|But|\*)\s+(.*\S)\s*$/i
const SCENARIO_RE = /^(?:Scenario(?: Outline| Template)?|Example)\s*:\s*(.*)$/i

// Rows are the single source for both the text form and the highlighted view.
export function toRows(tc) {
  const rows = [{ kind: 'scenario', kw: 'Scenario:', text: tc.title || '' }]
  for (const [key, label] of SECTIONS) {
    const lines = Array.isArray(tc[key]) ? tc[key] : (tc[key] ? [tc[key]] : [])
    lines.filter(Boolean).forEach((text, i) => rows.push({ kind: 'step', section: key, kw: i === 0 ? label : 'And', text }))
  }
  return rows
}

export function toGherkin(tc) {
  return toRows(tc).map(r => (r.kind === 'scenario' ? `${r.kw} ${r.text}` : `  ${r.kw} ${r.text}`)).join('\n')
}

// Returns { title, given, when, then, errors: [], warnings: [] }.
export function fromGherkin(text) {
  const out = { title: '', given: [], when: [], then: [], errors: [], warnings: [] }
  const background = []
  let current = null          // 'given' | 'when' | 'then' | 'background'
  let lastTarget = null       // array holding the last step, for continuation lines
  let scenarios = 0
  let inDocString = false
  let mergedContext = false
  let lastKeyIdx = -1

  const lines = String(text || '').split('\n')
  lines.forEach((raw, idx) => {
    const n = idx + 1
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('@')) return

    if (line.startsWith('"""') || line.startsWith('```')) { inDocString = !inDocString; return }
    if (inDocString || line.startsWith('|')) {            // doc strings / tables: fold into the previous step
      if (lastTarget && lastTarget.length) lastTarget[lastTarget.length - 1] += ' ' + line.replace(/^\|\s*|\s*\|$/g, '')
      return
    }

    if (/^Feature\s*:/i.test(line)) { mergedContext = true; return }
    if (/^Background\s*:/i.test(line)) { current = 'background'; mergedContext = true; return }

    const sc = line.match(SCENARIO_RE)
    if (sc) {
      scenarios += 1
      if (scenarios > 1) out.errors.push(`Line ${n}: only one Scenario per test case — add another test case instead.`)
      else out.title = sc[1].trim()
      current = null
      return
    }

    const st = line.match(STEP_RE)
    if (!st) {
      out.errors.push(`Line ${n}: expected Given, When, Then, And or But — got "${line.slice(0, 40)}".`)
      return
    }
    const kw = st[1].toLowerCase()
    const stepText = st[2].trim()
    if (kw === 'given' || kw === 'when' || kw === 'then') {
      const key = current === 'background' ? 'background' : kw
      if (current === 'background' && kw !== 'given') current = kw
      else current = key
      if (key !== 'background' && SECTIONS.findIndex(s => s[0] === key) < lastKeyIdx) {
        out.warnings.push('Steps are stored grouped as Given / When / Then, so a sequence that goes back to an earlier keyword is merged into that group.')
      }
      if (key !== 'background') lastKeyIdx = Math.max(lastKeyIdx, SECTIONS.findIndex(s => s[0] === key))
    } else if (!current) {
      out.errors.push(`Line ${n}: "${st[1]}" must follow a Given, When or Then.`)
      return
    }
    const target = current === 'background' ? background : out[current]
    target.push(stepText)
    lastTarget = target
  })

  if (inDocString) out.errors.push('A """ block is never closed.')
  if (background.length) {
    out.given = [...background, ...out.given]
    out.warnings.push('Background steps were merged into Given — a test case holds one scenario.')
  } else if (mergedContext) {
    out.warnings.push('Feature / Background lines are not part of a single test case and were ignored.')
  }
  if (!scenarios && !out.errors.length) out.warnings.push('No "Scenario:" line — the existing title is kept.')
  out.warnings = [...new Set(out.warnings)]
  return out
}
