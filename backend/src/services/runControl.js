/**
 * Per-feature pause and redo-with-hint helpers for the Runner.
 *
 * Self-contained on purpose (no store/db import) so it can be unit-tested with
 * `node --test`. runner.js and routes/tests.js wire it to the live state.
 */

export const HINT_MAX = 1000;
export const REDO_MAX_CASES = 50;
// Whitespace runs are bounded ({0,16}) so the pattern cannot backtrack polynomially on hostile input.
// The runtime wraps the hint in <hint> tags; a hint must not be able to close them early.
export const HINT_TAG_RE = /<\s{0,16}\/?\s{0,16}hint\s{0,16}>/gi;

// A feature is in `pausedFeatures` from the moment a human asks to pause. It is
// also in `heldFeatures` once its run loop is actually idle at a test-case
// boundary (a case already running inside the agent cannot be interrupted).
export const pausedFeatures = new Set();
export const heldFeatures = new Set();

export function pauseState(feature) {
  return { feature, paused: pausedFeatures.has(feature), holding: heldFeatures.has(feature) };
}

export function listPaused() {
  return [...pausedFeatures].map(pauseState);
}

export function clearPause(feature) {
  pausedFeatures.delete(feature);
  heldFeatures.delete(feature);
}

/**
 * Called by a feature's run loop before each test case. Resolves when the
 * feature is not paused (or the run was stopped). `onHold` / `onRelease` fire
 * only if it actually had to wait.
 */
export async function holdWhilePaused(feature, isStopped, { onHold, onRelease, pollMs = 300 } = {}) {
  if (!pausedFeatures.has(feature) || isStopped()) return;
  heldFeatures.add(feature);
  onHold?.();
  while (pausedFeatures.has(feature) && !isStopped()) {
    await new Promise(r => setTimeout(r, pollMs));
  }
  heldFeatures.delete(feature);
  onRelease?.();
}

// The hint is free text from a human. It is sent to the runtime as data (the
// runtime prompt says so); here we only bound it and strip control characters.
export function normalizeHint(x) {
  let t = String(x ?? '').slice(0, HINT_MAX * 2)   // bound the work before any regex runs
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // Repeat until stable: removing "</hint>" from "<</hint>/hint>" must not leave a new tag.
  for (let prev; prev !== t;) { prev = t; t = t.replace(HINT_TAG_RE, ''); }
  return t.trim().slice(0, HINT_MAX);
}

/**
 * Validate a redo request and resolve it against server-side state. Test case
 * definitions come from `casesByFeature`, never from the request body.
 * Returns { error, status } or { testCases, hints }; hints[tcId] = { hint, retryOf }
 * where retryOf is the newest archived run that has a PASS/FAIL result for that case.
 */
export function planRedo({ feature, testCaseIds, hint, featureList, casesByFeature, archive, activeFeatures }) {
  const text = normalizeHint(hint);
  if (!text) return { status: 400, error: 'hint required' };
  if (typeof feature !== 'string' || !featureList.includes(feature)) return { status: 404, error: 'Feature not found' };
  if (!Array.isArray(testCaseIds) || !testCaseIds.length || testCaseIds.length > REDO_MAX_CASES) {
    return { status: 400, error: `testCaseIds must list 1-${REDO_MAX_CASES} test cases` };
  }
  if (activeFeatures.has(feature)) {
    return { status: 409, error: `${feature} is still running. Let it finish or Stop the run, then redo.` };
  }
  const cases = casesByFeature[feature] || [];
  const testCases = [];
  for (const id of new Set(testCaseIds)) {
    const tc = cases.find(c => c.id === id);
    if (!tc) return { status: 400, error: `${id} is not a test case of ${feature}` };
    testCases.push(tc);
  }
  const hints = {};
  for (const tc of testCases) {
    const prior = archive.find(r => (r.features?.[feature]?.cases || []).some(c => c.id === tc.id && (c.status === 'PASS' || c.status === 'FAIL')));
    hints[tc.id] = { hint: text, retryOf: prior?.runId || null };
  }
  return { testCases, hints };
}

// Records on an archived/in-memory run record that one of its cases was retried
// with human input. Both runs are kept; this is only the link back.
export function addRetry(record, tcId, entry) {
  for (const f of Object.values(record?.features || {})) {
    const c = (f.cases || []).find(x => x.id === tcId);
    if (c) { c.retries = [...(c.retries || []), entry]; return true; }
  }
  return false;
}
