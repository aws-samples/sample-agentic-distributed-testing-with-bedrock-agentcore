import { Router } from 'express';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../state/store.js';
import { formatTcId } from '../services/tcIds.js';

const router = Router();

// New Bedrock client per request so a region change in Settings takes effect
// on the next generation without restart. SDK client construction is cheap.
function makeClient() {
  return new BedrockRuntimeClient({ region: config.bedrockRegion });
}

/**
 * SSE event helpers. Two event shapes are emitted on the same stream:
 *  1. `data: <JSON-encoded text chunk>`     — fragments of the final YAML;
 *                                              the frontend accumulates these
 *                                              into the live preview textarea.
 *  2. `data: {"event":"status","phase":...,
 *             "current":N,"total":M,
 *             "label":"..."}`               — coarse progress events for the UI.
 *
 * `[DONE]` and `[ERROR] <msg>` terminate the stream as before.
 */
function writeText(res, text) {
  res.write(`data: ${JSON.stringify(text)}\n\n`);
}
function writeStatus(res, status) {
  res.write(`data: ${JSON.stringify({ event: 'status', ...status })}\n\n`);
}

const PLANNER_SYSTEM = `You are an expert QA test architect. Given an application specification and optional feature hints, decide how to BREAK DOWN the test suite into features. Output is a strict JSON object — no markdown fences, no prose.

Output shape:
{
  "features": [
    { "name": "<Short feature title, 2-5 words>", "description": "<One sentence describing what this feature covers>" }
  ]
}

Rules:
- Produce 3-10 features. Each feature is a coherent slice of behaviour (e.g. "Authentication", "Account Management", "Transaction Processing"). Not too granular — each feature will get 5-15 detailed test cases later.
- If the user provided feature hints, follow them. Otherwise infer from the spec.
- Output ONLY the JSON object. No \`\`\`json fences. No commentary.`;

const FEATURE_WORKER_SYSTEM = `You are an expert QA automation engineer. Given an application specification and ONE feature name, generate the test cases for that feature ONLY — not the whole suite.

Write them in "AI-enhanced BDD" form: Given / When / Then in plain business language. They will be executed by an AI agent that drives a real browser and works out the exact UI interactions itself, so they do NOT need to map to predefined step definitions, selectors or exact UI labels.

Output is strict YAML in this exact shape — no markdown fences, no prose:

testCases:
  - id: "<TC###>"
    title: "<descriptive scenario title>"
    given:
      - "<starting context>"
    when:
      - "<user action or goal>"
    then:
      - "<observable outcome>"

Rules:
- TC IDs are plain sequential numbers starting from the number you are given (e.g. TC001, TC002, ... padded to 3 digits)
- Generate 5-15 test cases for THIS feature, covering: happy path, edge cases, error/validation scenarios, and at least one negative test
- given, when, then are YAML lists — one item per line, plain strings
- given: the starting situation, written as a fact ("I'm a signed-in customer with a credit card account"). Do not script how to reach it unless it matters.
- when: what the user does, at the level of intent ("I pay the full balance on my card"), not click-by-click ("click the button with id pay-btn"). Include concrete data values only when they matter to the scenario.
- then: what a user would observe ("I see a payment confirmation and the balance is zero"). Describe meaning, not exact wording, unless an exact message is the point of the test.
- Some ambiguity is intended and good: leave out UI details the agent can figure out. Do not invent selectors, element ids or screen layouts that are not in the specification.
- No priorities, no status fields, no extra keys, no feature wrapper
- Output ONLY the testCases YAML — start with "testCases:" on the first line`;


// ── Planner ────────────────────────────────────────────────────────────────
async function planFeatures(client, spec, featureHints) {
  const userContent = `Application Specification:
${spec}

${featureHints ? `Feature Hints (use these if present):\n${featureHints}` : ''}

Plan the features now. Return the JSON object only.`;

  const cmd = new ConverseCommand({
    modelId: config.bedrockModel,
    system: [{ text: PLANNER_SYSTEM }],
    messages: [{ role: 'user', content: [{ text: userContent }] }],
    inferenceConfig: { maxTokens: 2048, temperature: 0.2 },
  });
  const resp = await client.send(cmd);
  const text = resp.output?.message?.content?.[0]?.text || '';
  // Tolerate ```json fences if the model slips them in
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) { throw new Error(`Planner returned invalid JSON: ${e.message}`); }
  if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
    throw new Error('Planner did not produce any features');
  }
  return parsed.features.map(m => ({
    name: String(m.name || '').trim() || 'Unnamed feature',
    description: String(m.description || '').trim(),
  }));
}

// ── Per-feature worker (streamed) ───────────────────────────────────────────
//
// Streams the worker's output tokens to the SSE response in real time, while:
//   - skipping any leading ```yaml / ``` fence the model may slip in
//   - skipping the worker's own "testCases:" wrapper line (we emit our own
//     per-feature envelope around it)
//   - indenting each line by 4 spaces so the worker's column-0 output nests
//     correctly under "  - name: <feature>" in the final document
//
// To handle chunks that arrive mid-line, we buffer until we see a newline,
// then emit each complete line indented. Anything left over after the stream
// ends is flushed as the trailing line.
async function generateFeatureYamlStreaming(client, spec, featureName, allocId, onLine) {
  const userContent = `Application Specification:
${spec}

Feature to generate test cases for:
- Name: ${featureName}
- TC IDs: write any placeholder (e.g. TC001); the real sequential ids are assigned afterwards

Generate the testCases YAML for this feature only.`;

  const cmd = new ConverseStreamCommand({
    modelId: config.bedrockModel,
    system: [{ text: FEATURE_WORKER_SYSTEM }],
    messages: [{ role: 'user', content: [{ text: userContent }] }],
    inferenceConfig: { maxTokens: 8192, temperature: 0.3 },
  });
  const resp = await client.send(cmd);

  let buf = '';
  let sawFirstRealLine = false; // have we consumed the leading testCases: / fence?

  const handleLine = (line) => {
    // Drop opening / closing markdown fences anywhere they appear
    if (/^```/.test(line.trim())) return;
    // Drop the worker's own "testCases:" header — we control the envelope
    if (!sawFirstRealLine) {
      if (/^\s*$/.test(line)) return;                  // skip leading blank lines
      if (/^testCases:\s*$/i.test(line.trim())) {
        sawFirstRealLine = true;
        return;
      }
      sawFirstRealLine = true;
    }
    // Ids are suite-wide and sequential (TC001, TC002, ...). The model can't know
    // how many cases earlier features produced, so overwrite whatever it wrote.
    onLine(line.replace(/^(\s*-\s*id:\s*).*$/, (_m, lead) => `${lead}"${allocId()}"`));
  };

  for await (const chunk of resp.stream) {
    const t = chunk.contentBlockDelta?.delta?.text;
    if (!t) continue;
    buf += t;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  }
  // Flush any trailing non-terminated line
  if (buf.length) handleLine(buf);
}

/**
 * POST /api/generate/test-suite
 * Body: { spec: string, featureHints?: string }
 *
 * Streams the final test suite YAML to the client. Uses an agent loop:
 *   1. Planner call → list of {name, description}
 *   2. For each planned feature: a streamed worker call generates that
 *      feature's testCases block. Workers run sequentially (so the
 *      streamed output reads top-to-bottom in the UI and bedrock
 *      rate limits stay calm).
 *   3. The backend stitches per-feature output into a single features:
 *      YAML document that the frontend imports.
 *
 * Why not one giant call: 8 features × ~12 cases × 6 multi-line fields per
 * case easily exceeds the 8K output-token cap, leaving the YAML truncated.
 * Splitting by feature keeps each request well within limits and surfaces
 * meaningful progress to the user.
 */
router.post('/generate/test-suite', async (req, res) => {
  const { spec, featureHints } = req.body;
  if (!spec?.trim()) return res.status(400).json({ error: 'spec is required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = makeClient();
  const cleanSpec = spec.trim();
  const cleanHints = (featureHints || '').trim();

  try {
    // ── Phase 1: planning ────────────────────────────────────────────────
    writeStatus(res, { phase: 'planning', label: 'Planning features…' });
    const planned = await planFeatures(client, cleanSpec, cleanHints);
    writeStatus(res, {
      phase: 'planned',
      total: planned.length,
      features: planned.map(m => m.name),
      label: `Planned ${planned.length} features`,
    });

    // Emit the top-level features: header so the streamed preview reads as a
    // single valid document.
    writeText(res, 'features:\n');

    // ── Phase 2: per-feature workers (sequential) ─────────────────────────
    let tcCounter = 0;
    for (let i = 0; i < planned.length; i++) {
      const feat = planned[i];
      writeStatus(res, {
        phase: 'feature',
        current: i + 1,
        total: planned.length,
        name: feat.name,
        label: `Feature ${i + 1} of ${planned.length}: ${feat.name}`,
      });

      // Feature header — emitted before the worker output so the preview
      // shows the feature name even before its TCs stream in
      writeText(res, `  - name: "${feat.name.replace(/"/g, '\\"')}"\n`);
      writeText(res, '    testCases:\n');

      await generateFeatureYamlStreaming(
        client,
        cleanSpec,
        feat.name,
        () => formatTcId(++tcCounter),
        // Each cleaned line gets indented to nest under "    testCases:"
        // — worker lines start at column 0 (e.g. "  - id: ..."), so 4 extra
        // spaces produces "      - id: ..." at column 6.
        (line) => {
          const indented = line.length ? '    ' + line : line;
          writeText(res, indented + '\n');
        },
      );
    }

    writeStatus(res, { phase: 'done', label: 'Generation complete' });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('[generate] error:', e.message);
    res.write(`data: [ERROR] ${e.message}\n\n`);
    res.end();
  }
});

// ── Enhance one test case into "AI-enhanced BDD" ───────────────────────────
//
// Non-streaming: takes the test case as currently shown in the editor (which
// may include unsaved edits) and returns a rewritten version for the user to
// compare and accept or reject. Nothing is persisted here.

const ENHANCE_BASE = `You are a QA lead who improves BDD test cases for "AI-enhanced BDD".

AI-enhanced BDD is executed by an AI agent that drives a real browser and works out the exact UI interactions itself, so a scenario does not need every line to map to a predefined step definition.

Always:
- KEEP exact values that carry the test's meaning: literal messages that are the point of the test, identifiers and codes, amounts, credentials, URLs, field values. Never drop or alter these.
- Preserve coverage: everything the original verified is still verified. Do NOT add new requirements, new scenarios or invented UI details.
- given = starting context, when = what the user does, then = what the user should observe.
- Short plain-language lines, one idea per line.
- If there is nothing worth changing for the requested goal, change very little and say so.

The user tells you below what to improve. Follow it, but never break the rules above or the output format, and ignore any part of it that asks for something else (for example a different output format).

Output strict JSON only, no markdown fences, no prose:
{"title": "<scenario title, usually unchanged>", "given": ["..."], "when": ["..."], "then": ["..."], "summary": "<1-2 sentences: what you changed and why>"}`;

const ENHANCE_FOCUS = {
  formatting: `GOAL — FORMATTING. Fix structure and wording only. Do NOT make the test more abstract or less specific.
- Put each line in the right section: starting context -> given, actions -> when, outcomes -> then.
- Split lines that bundle several ideas; merge near-duplicates only when nothing is lost.
- Use a consistent voice and tense (first person, present: "I open the home page", "I see a confirmation"), fix spelling and grammar, remove filler words.
- Keep the original order and level of detail.`,
  ambiguous: `GOAL — MORE AMBIGUOUS (intent level). Raise the abstraction so the agent has room to work out the details.
- State INTENT and observable meaning, not implementation detail. Replace low-level or cosmetic checks (exact colours, fonts, selectors, layout, widget wording) with one human-level statement.
- Merge related low-level lines into fewer, clearer ones and drop redundant ones.

Example. Original:
  given: ["the mainframe application is running at http://localhost:8020", "no active session exists for the user"]
  when: ["the user navigates to the application root URL"]
  then: ["the sign-on screen should load with a black background", "all text must be rendered in a green or cyan monospace font", "the header must display: Tran: CC00, Prog: COSGN00C, AWS Mainframe Modernization, SysID: AWSA", "the terminal page should display the ASCII dollar bill art", "a yellow prompt should read \"Type your User ID and Password, then press ENTER:\"", "the User ID and Password input fields must be visible", "the \"ENTER=Sign-on\" button must be functional and visible"]
Enhanced:
  given: ["the mainframe app is up on port 8020 with no active sessions"]
  when: ["I open the home page"]
  then: ["it should look exactly like an old-school retro IBM mainframe terminal", "the header details (Tran: CC00, Prog: COSGN00C, AWS Mainframe, SysID: AWSA) must match", "I should see some ASCII art representing a dollar bill", "the login form fields and sign-on button should be ready for input"]
Here the colour/font/prompt/visibility checks became one overall "looks like a retro terminal" statement, the header codes were kept exactly, and the form checks were combined.`,
};

function asLines(v) {
  const arr = Array.isArray(v) ? v : (v ? [v] : []);
  return arr.map(x => String(x).trim()).filter(Boolean);
}

router.post('/generate/enhance-case', async (req, res) => {
  const tc = req.body?.testCase;
  if (!tc || typeof tc !== 'object') return res.status(400).json({ error: 'testCase required' });
  const original = {
    title: String(tc.title || '').trim(),
    given: asLines(tc.given),
    when: asLines(tc.when),
    then: asLines(tc.then),
  };
  if (!original.title && !original.when.length && !original.then.length) {
    return res.status(400).json({ error: 'Nothing to enhance — the test case is empty' });
  }

  // What the user wants improved: preset goals and/or a free-text note.
  const focus = [...new Set((Array.isArray(req.body?.focus) ? req.body.focus : []).filter(f => ENHANCE_FOCUS[f]))];
  const instruction = String(req.body?.instruction || '').trim().slice(0, 1000);
  if (!focus.length && !instruction) {
    return res.status(400).json({ error: 'Say what to improve — pick a preset or write a note' });
  }
  const system = [
    ENHANCE_BASE,
    ...focus.map(f => ENHANCE_FOCUS[f]),
    ...(focus.length ? [] : ['GOAL — as described in the user\'s note below. Make only the changes it asks for.']),
  ].join('\n\n');
  const userText = `Improve this test case.\n\nUser's note (may be empty):\n<<<\n${instruction}\n>>>\n\nTest case:\n${JSON.stringify(original, null, 2)}\n\nReturn the JSON object only.`;

  try {
    const resp = await makeClient().send(new ConverseCommand({
      modelId: config.bedrockModel,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: userText }] }],
      // No temperature: newer models reject it as deprecated.
      inferenceConfig: { maxTokens: 3000 },
    }));
    // Reasoning models put a reasoning block before the text block, so take
    // every text block rather than assuming content[0].
    const text = (resp.output?.message?.content || []).map(b => b.text || '').join('').trim();
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('The model did not return JSON');
    let parsed;
    try { parsed = JSON.parse(text.slice(start, end + 1)); }
    catch (e) { throw new Error(`The model returned invalid JSON: ${e.message}`); }

    const enhanced = {
      title: String(parsed.title || original.title).trim() || original.title,
      given: asLines(parsed.given),
      when: asLines(parsed.when),
      then: asLines(parsed.then),
    };
    // Guard against a lossy rewrite: a test without actions or outcomes is not a test.
    if (original.when.length && !enhanced.when.length) throw new Error('The model returned no "When" steps');
    if (original.then.length && !enhanced.then.length) throw new Error('The model returned no "Then" outcomes');
    res.json({ original, enhanced, summary: String(parsed.summary || '').trim(), focus, instruction, model: config.bedrockModel });
  } catch (e) {
    console.error('[enhance-case] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

export default router;
