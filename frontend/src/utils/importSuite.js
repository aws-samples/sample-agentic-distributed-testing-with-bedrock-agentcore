import jsyaml from 'js-yaml'

/**
 * Parse an uploaded test-suite file into the editor's { targetUrl?, features[] } shape.
 * Returns { doc, summary } or throws an Error whose message is fit to show to the user.
 *
 * Also accepts files from before the renames: `modules:` for `features:`, and
 * preconditions / steps / expectedResult for given / when / then.
 */
export function parseSuiteYaml(text) {
  let parsed
  try { parsed = jsyaml.load(text) }
  catch (e) { throw new Error(`This isn't valid YAML: ${e.message.split('\n')[0]}`) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a YAML file with a top-level "features:" list. Download the template to see the format.')
  }
  if (!parsed.features && Array.isArray(parsed.modules)) parsed.features = parsed.modules
  if (!Array.isArray(parsed.features)) {
    throw new Error('Expected a top-level "features:" list. Download the template to see the format.')
  }

  const problems = []
  parsed.features.forEach((f, fi) => {
    if (!f || typeof f !== 'object' || !String(f.name || '').trim()) { problems.push(`Feature ${fi + 1} has no name`); return }
    if (f.testCases !== undefined && !Array.isArray(f.testCases)) { problems.push(`"${f.name}": testCases must be a list`); return }
    for (const [ti, tc] of (f.testCases || []).entries()) {
      if (tc.given === undefined && tc.preconditions !== undefined) tc.given = tc.preconditions
      if (tc.when === undefined && tc.steps !== undefined) tc.when = tc.steps
      if (tc.then === undefined && tc.expectedResult !== undefined) tc.then = tc.expectedResult
      delete tc.preconditions; delete tc.steps; delete tc.expectedResult
      // Files say `scenario:`; older exports say `title:`. Normalise to the editor's field.
      if (tc.scenario !== undefined) { if (tc.title === undefined) tc.title = tc.scenario; delete tc.scenario }
      if (!String(tc.title || '').trim()) problems.push(`"${f.name}": test case ${ti + 1} has no scenario`)
    }
  })
  if (problems.length) {
    throw new Error(`Fix these and try again:\n• ${problems.slice(0, 6).join('\n• ')}${problems.length > 6 ? `\n• …and ${problems.length - 6} more` : ''}`)
  }
  if (parsed.features.length === 0) throw new Error('The file has no features in it.')

  const features = parsed.features.length
  const cases = parsed.features.reduce((n, f) => n + (f.testCases || []).length, 0)
  return { doc: parsed, summary: { features, cases, names: parsed.features.map(f => f.name) } }
}
