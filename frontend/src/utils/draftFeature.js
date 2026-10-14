import jsyaml from 'js-yaml'

/**
 * Ask the backend to turn a spec into ONE feature: { name, description?, testCases[] }.
 * The endpoint streams server-sent events carrying the YAML; this collects them,
 * parses the result and validates it. Throws an Error whose message is fit to show.
 * Aborting `signal` cancels the request (and the server stops generating).
 */
export async function draftFeature({ spec, featureName = '', signal }) {
  const resp = await fetch('/api/generate/test-suite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec, featureName }),
    signal,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || `${resp.status} ${resp.statusText}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let text = ''
  let finished = false
  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()   // keep the incomplete trailing line
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const payload = line.slice(6)
      if (payload === '[DONE]') { finished = true; break }
      if (payload.startsWith('[ERROR]')) throw new Error(payload.slice(8).trim() || 'Generation failed')
      try {
        const parsed = JSON.parse(payload)
        if (typeof parsed === 'string') text += parsed   // status events are objects: ignored here
      } catch { /* skip malformed */ }
    }
  }
  if (!text.trim()) throw new Error('Nothing came back. Try again.')

  let doc
  try { doc = jsyaml.load(text) }
  catch (e) { throw new Error(`The generated YAML couldn't be read (${e.message.split('\n')[0]}). Try again.`) }
  const feature = doc?.features?.[0]
  if (!feature || !Array.isArray(feature.testCases) || feature.testCases.length === 0) {
    throw new Error('No test cases came back. Try again, or add more detail to the spec.')
  }
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String)
  return {
    name: String(feature.name || '').trim(),
    description: String(feature.description || '').trim(),
    testCases: feature.testCases.map(tc => ({
      title: String(tc.scenario ?? tc.title ?? '').trim(),
      given: list(tc.given), when: list(tc.when), then: list(tc.then),
    })),
  }
}
