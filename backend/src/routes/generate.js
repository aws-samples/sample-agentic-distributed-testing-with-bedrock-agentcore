import { Router } from 'express';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../state/store.js';

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

const PLANNER_SYSTEM = `You are an expert QA test architect. Given an application specification and optional module hints, decide how to BREAK DOWN the test suite into modules. Output is a strict JSON object — no markdown fences, no prose.

Output shape:
{
  "modules": [
    { "name": "<Short module title, 2-5 words>", "description": "<One sentence describing what this module covers>" }
  ]
}

Rules:
- Produce 3-10 modules. Each module is a coherent slice of behaviour (e.g. "Authentication", "Account Management", "Transaction Processing"). Not too granular — each module will get 5-15 detailed test cases later.
- If the user provided module hints, follow them. Otherwise infer from the spec.
- Output ONLY the JSON object. No \`\`\`json fences. No commentary.`;

const MODULE_WORKER_SYSTEM = `You are an expert QA automation engineer. Given an application specification and ONE module name, generate the test cases for that module ONLY — not the whole suite.

Output is strict YAML in this exact shape — no markdown fences, no prose:

testCases:
  - id: "<MD###-TC###>"
    title: "<descriptive title>"
    preconditions:
      - "<condition>"
    steps:
      - "<step>"
    expectedResult:
      - "<expected>"

Rules:
- TC IDs follow the prefix you are given (e.g. MD003-TC001, MD003-TC002, ... padded to 3 digits)
- Generate 5-15 test cases for THIS module, covering: happy path, edge cases, error/validation scenarios, and at least one negative test
- preconditions, steps, expectedResult are YAML lists — one item per line, plain strings
- No priorities, no status fields, no extra keys, no module wrapper
- Output ONLY the testCases YAML — start with "testCases:" on the first line`;

function modIdPrefix(i) { return 'MD' + String(i + 1).padStart(3, '0'); }

// ── Planner ────────────────────────────────────────────────────────────────
async function planModules(client, spec, moduleHints) {
  const userContent = `Application Specification:
${spec}

${moduleHints ? `Module Hints (use these if present):\n${moduleHints}` : ''}

Plan the modules now. Return the JSON object only.`;

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
  if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) {
    throw new Error('Planner did not produce any modules');
  }
  return parsed.modules.map(m => ({
    name: String(m.name || '').trim() || 'Unnamed module',
    description: String(m.description || '').trim(),
  }));
}

// ── Per-module worker (streamed) ───────────────────────────────────────────
//
// Streams the worker's output tokens to the SSE response in real time, while:
//   - skipping any leading ```yaml / ``` fence the model may slip in
//   - skipping the worker's own "testCases:" wrapper line (we emit our own
//     per-module envelope around it)
//   - indenting each line by 4 spaces so the worker's column-0 output nests
//     correctly under "  - name: <module>" in the final document
//
// To handle chunks that arrive mid-line, we buffer until we see a newline,
// then emit each complete line indented. Anything left over after the stream
// ends is flushed as the trailing line.
async function generateModuleYamlStreaming(client, spec, moduleName, modulePrefix, onLine) {
  const userContent = `Application Specification:
${spec}

Module to generate test cases for:
- Name: ${moduleName}
- TC ID prefix: ${modulePrefix} (use ${modulePrefix}-TC001, ${modulePrefix}-TC002, ...)

Generate the testCases YAML for this module only.`;

  const cmd = new ConverseStreamCommand({
    modelId: config.bedrockModel,
    system: [{ text: MODULE_WORKER_SYSTEM }],
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
    onLine(line);
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
 * Body: { spec: string, moduleHints?: string }
 *
 * Streams the final test suite YAML to the client. Uses an agent loop:
 *   1. Planner call → list of {name, description}
 *   2. For each planned module: a streamed worker call generates that
 *      module's testCases block. Workers run sequentially (so the
 *      streamed output reads top-to-bottom in the UI and bedrock
 *      rate limits stay calm).
 *   3. The backend stitches per-module output into a single modules:
 *      YAML document that the frontend imports.
 *
 * Why not one giant call: 8 modules × ~12 cases × 6 multi-line fields per
 * case easily exceeds the 8K output-token cap, leaving the YAML truncated.
 * Splitting by module keeps each request well within limits and surfaces
 * meaningful progress to the user.
 */
router.post('/generate/test-suite', async (req, res) => {
  const { spec, moduleHints } = req.body;
  if (!spec?.trim()) return res.status(400).json({ error: 'spec is required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const client = makeClient();
  const cleanSpec = spec.trim();
  const cleanHints = (moduleHints || '').trim();

  try {
    // ── Phase 1: planning ────────────────────────────────────────────────
    writeStatus(res, { phase: 'planning', label: 'Planning modules…' });
    const planned = await planModules(client, cleanSpec, cleanHints);
    writeStatus(res, {
      phase: 'planned',
      total: planned.length,
      modules: planned.map(m => m.name),
      label: `Planned ${planned.length} modules`,
    });

    // Emit the top-level modules: header so the streamed preview reads as a
    // single valid document.
    writeText(res, 'modules:\n');

    // ── Phase 2: per-module workers (sequential) ─────────────────────────
    for (let i = 0; i < planned.length; i++) {
      const mod = planned[i];
      const prefix = modIdPrefix(i);
      writeStatus(res, {
        phase: 'module',
        current: i + 1,
        total: planned.length,
        name: mod.name,
        label: `Module ${i + 1} of ${planned.length}: ${mod.name}`,
      });

      // Module header — emitted before the worker output so the preview
      // shows the module name even before its TCs stream in
      writeText(res, `  - name: "${mod.name.replace(/"/g, '\\"')}"\n`);
      writeText(res, '    testCases:\n');

      await generateModuleYamlStreaming(
        client,
        cleanSpec,
        mod.name,
        prefix,
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

export default router;
