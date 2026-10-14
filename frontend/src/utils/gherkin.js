// The Gherkin tab's text <-> the stored test case { title, given[], when[], then[] }.
//
// Written form is Gherkin keywords laid out like a YAML tree: the scenario on
// one line, then each keyword as a header with its steps as a "- " list below:
//
//   Scenario: Customer pays the full balance
//
//   Given:
//     - I am a signed-in customer
//   When:
//     - I pay the full balance
//   Then:
//     - I see a confirmation
//     - the balance shows as zero
//
// Reading is lenient: classic Gherkin (Given x / And y / When z ...) pasted in
// is understood too, and is rewritten in the form above. Storage stays three
// arrays, so an "And" simply joins the keyword before it. One test case = one
// Scenario; a Background (if pasted in) is merged into Given.

const SECTIONS = [['given', 'Given'], ['when', 'When'], ['then', 'Then']]
const STEP_RE = /^(Given|When|Then|And|But|\*)\s+(.*\S)\s*$/i          // classic: "Given I am ..."
const HEADER_RE = /^(Given|When|Then)\s*:\s*(.*?)\s*$/i                  // "Given:" (optionally "Given: first step")
const ITEM_RE = /^[-*]\s+(.*\S)\s*$/                                    // "- a step"
const EMPTY_ITEM_RE = /^[-*]\s*$/                                        // "-" with nothing after it yet
const SCENARIO_RE = /^(?:Scenario(?: Outline| Template)?|Example)\s*:\s*(.*)$/i

/**
 * Rows are the single source for the text form and for the highlighted views in
 * the dialogs. kinds: 'scenario' | 'header' (Given: ...) | 'step' ("- ...").
 * omitEmpty drops a header whose list is empty (used by read-only previews).
 */
export function toRows(tc, { omitEmpty = false } = {}) {
  const rows = [{ kind: 'scenario', kw: 'Scenario:', text: tc.title || '' }]
  for (const [key, label] of SECTIONS) {
    const lines = (Array.isArray(tc[key]) ? tc[key] : (tc[key] ? [tc[key]] : [])).filter(Boolean)
    if (omitEmpty && lines.length === 0) continue
    rows.push({ kind: 'header', section: key, kw: `${label}:`, text: '' })
    lines.forEach(text => rows.push({ kind: 'step', section: key, kw: '-', text }))
  }
  return rows
}

export function toGherkin(tc) {
  const out = []
  for (const r of toRows(tc)) {
    if (r.kind === 'scenario') out.push(`${r.kw} ${r.text}`.trimEnd(), '')
    else if (r.kind === 'header') out.push(r.kw)
    else out.push(`  - ${r.text}`)
  }
  return out.join('\n')
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

  // Switch to a Given / When / Then section (inside a Background, Given stays in it).
  const enterSection = (kw) => {
    const key = current === 'background' ? 'background' : kw
    if (current === 'background' && kw !== 'given') current = kw
    else current = key
    if (key !== 'background') {
      const idx = SECTIONS.findIndex(s => s[0] === key)
      if (idx < lastKeyIdx) out.warnings.push('Steps are stored grouped as Given / When / Then, so a sequence that goes back to an earlier keyword is merged into that group.')
      lastKeyIdx = Math.max(lastKeyIdx, idx)
    }
  }
  const addStep = (stepText) => {
    const target = current === 'background' ? background : out[current]
    target.push(stepText)
    lastTarget = target
  }

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

    // "Given:" / "When:" / "Then:" header, with an optional first step on the same line
    const hd = line.match(HEADER_RE)
    if (hd) {
      enterSection(hd[1].toLowerCase())
      if (hd[2]) addStep(hd[2])
      return
    }

    // "- a step" under the current header
    if (EMPTY_ITEM_RE.test(line)) return           // a dash still being typed
    const item = line.match(ITEM_RE)
    if (item) {
      if (!current) { out.errors.push(`Line ${n}: put this step under a "Given:", "When:" or "Then:" header.`); return }
      addStep(item[1].trim())
      return
    }

    // classic "Given I am ..." / "And ..." lines
    const st = line.match(STEP_RE)
    if (!st) {
      if (/^(Given|When|Then)$/i.test(line)) {      // the colon is the usual thing to forget
        out.errors.push(`Line ${n}: add a colon — "${line}:" — then list its steps underneath with "- ".`)
        return
      }
      out.errors.push(`Line ${n}: expected "Scenario:", a "Given:" / "When:" / "Then:" header, or a "- step" — got "${line.slice(0, 40)}".`)
      return
    }
    const kw = st[1].toLowerCase()
    if (kw === 'given' || kw === 'when' || kw === 'then') enterSection(kw)
    else if (!current) {
      out.errors.push(`Line ${n}: "${st[1]}" must follow a Given, When or Then.`)
      return
    }
    addStep(st[2].trim())
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
