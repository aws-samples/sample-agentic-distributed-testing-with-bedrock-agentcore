import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { config, sessions, testRuns, stopFlags, runLogs, saveTestResult, activeFeatures, featureDescriptions, currentSecrets } from '../state/store.js';
import { broadcast } from './websocket.js';
import { ensureSession, invokeLocalRuntime, makeRuntimeSessionId } from './sessions.js';
import { recordFrame, flushTcSnapshots } from './snapshots.js';
import { holdWhilePaused, clearPause, pausedFeatures, redoQueues, caseProgress, lastFrames, pauseState, takeQueuedRedo, isUnsafeKey } from './runControl.js';
import { createSseStream } from './sseParser.js';
import { redactSecrets, createRedactingBuffer } from './redact.js';

// Per-region client cache so live region changes from Settings are picked up
// without restarting the container.
const _clientCache = new Map();
function getAgentCoreClient() {
  const region = config.browserRegion;
  let c = _clientCache.get(region);
  if (!c) {
    c = new BedrockAgentCoreClient({ region });
    _clientCache.set(region, c);
  }
  return c;
}
function getRuntimeArn() {
  // No hardcoded fallback — in agentcore mode this must be set via the
  // AGENTCORE_RUNTIME_ARN env var (see docker-compose.yml) after deploying
  // agent-runtime-agentcore. If unset, the AgentCore SDK call below will
  // surface a clear validation error.
  return config.agentcoreRuntimeArn;
}

// Where parsed SSE events go: the feature's browser cell (screenshots) and `step` (the live step
// feed and the per-test-case log, see invokeRuntime). No `step`: the steps were already shown.
function makeSseSink(sessionId, runId, tcId, step) {
  return {
    screenshot(data) {
      const sess = sessions[sessionId];
      if (sess) { sess.screenshot = data; broadcast({ type: 'screenshot', sessionId, data, action: sess.action || '' }); }
      if (runId && tcId) { recordFrame(runId, tcId, data, sess?.action); lastFrames.set(tcId, data); }
    },
    step(action, kind) { step?.(action, kind); },
  };
}

// Masks secrets in the verdict reason before it is cut (sseParser.js).
const redactOpts = { redact: (t) => redactSecrets(t, currentSecrets()) };

// Rebuilds a verdict from a whole captured stream (local mode, where the live log is
// fed by invokeLocalRuntime's onLine callback instead).
function parseSSE(rawText, sessionId, runId, tcId) {
  const stream = createSseStream(makeSseSink(sessionId, runId, tcId, null), redactOpts);
  stream.write(new TextEncoder().encode(rawText));
  return stream.end();
}


export async function invokeRuntime(tc, runId, sessionId, hint = '') {
  const payload = {
    action: 'run_test',
    // The Feature's Background (its description) is shared setup that applies
    // before every scenario in the Feature; the runtime puts it in the prompt.
    testCase: { ...tc, background: featureDescriptions[tc.feature] || '' },
    targetUrl: config.targetUrl,
    // The testing agent's model + Bedrock region chosen in Settings; the runtime uses
    // these instead of the values it was started with.
    model: config.agentModel,
    region: config.agentRegion,
    // Context variables (name, value, when-to-use description) for the agent's prompt.
    env: config.envVars.map(({ name, value, description }) => ({ name, value, description })),
    // Human hint for a redo (see routes/tests.js POST /tests/redo); the runtime renders it as data.
    ...(hint ? { hint } : {}),
    sessionName: sessionId.replace(/\s+/g, '_'),
    // Pass auth context to the agent — system prompt will tell it
    // which credentials to use if the test asks it to log in
    // Accounts the agent may sign in with (admin and/or user), only those filled in.
    auth: (() => {
      if (!config.auth?.enabled) return null;
      const accounts = config.auth.accounts.filter(a => a.username).map(a => ({ role: a.role, username: a.username, password: a.password || '' }));
      return accounts.length ? { accounts } : null;
    })(),
  };

  // Init per-run log store
  if (!runLogs[runId]) runLogs[runId] = Object.create(null);   // keyed by test case id
  if (!runLogs[runId][tc.id]) runLogs[runId][tc.id] = [];
  const tcLog = runLogs[runId][tc.id];

  const logEntry = (msg, kind = 'info') => {
    // Redacted before it is stored, broadcast to every WebSocket client, replayed or archived.
    // ts is ISO; the browser formats it in the viewer's locale and timezone.
    const entry = { ts: new Date().toISOString(), msg: redactSecrets(msg, currentSecrets()), kind };
    tcLog.push(entry);
    // Live per-test-case log for the Runner's detail view; replayed on reconnect (websocket.js).
    broadcast({ type: 'tc_log', runId, testId: tc.id, sessionId, entry });
  };
  if (hint) logEntry(`Redo with human hint: ${hint}`, 'info');

  // The agent's text arrives in small pieces, and a secret can be split across them: join them per
  // line or sentence and mask the joined text (redact.js). logEntry masks once more when it stores.
  const textOut = createRedactingBuffer(currentSecrets, (clean) => {
    broadcast({ type: 'step_detail', sessionId, action: clean, kind: 'text' });
    logEntry(clean, 'text');
  });
  const step = (action, kind) => {
    if (kind === 'text') return textOut.push(action);
    textOut.flush();   // text before a tool step is shown before it
    const clean = redactSecrets(action, currentSecrets());
    broadcast({ type: 'step_detail', sessionId, action: clean, kind });
    logEntry(clean, kind);
  };

  try {
    let rawText = '';
    if (config.agentMode === 'local') {
      rawText = await invokeLocalRuntime(payload, (line) => {
        try {
          const ev = JSON.parse(line.slice(6))?.event;
          if (!ev) return;
          // Broadcast screenshots as they arrive (don't wait for run to finish)
          if (ev.screenshot?.data) {
            const sess = sessions[sessionId];
            if (sess) { sess.screenshot = ev.screenshot.data; }
            broadcast({ type: 'screenshot', sessionId, data: ev.screenshot.data, action: sessions[sessionId]?.action || '' });
            recordFrame(runId, tc.id, ev.screenshot.data, sess?.action);
            return;
          }
          const t = ev.contentBlockDelta?.delta?.text;
          if (t) step(t, 'text');
          const tool = ev.contentBlockStart?.start?.toolUse?.name;
          if (tool) step(`→ ${tool}`, 'tool');
        } catch { /* skip */ }
      });
    } else {
      // Reuse the same runtimeSessionId minted at connect time (see
      // makeRuntimeSessionId in services/sessions.js) so every test case in
      // this feature keeps landing on the same warm container — and thus the
      // same in-memory AgentCore Browser session — instead of each getting
      // its own container with its own abandoned browser session.
      const runtimeSessionId = sessions[sessionId]?.runtimeSessionId || makeRuntimeSessionId(sessionId);
      const cmd = new InvokeAgentRuntimeCommand({ agentRuntimeArn: getRuntimeArn(), qualifier: 'DEFAULT', runtimeSessionId, contentType: 'application/json', payload: new TextEncoder().encode(JSON.stringify(payload)) });
      const response = await getAgentCoreClient().send(cmd);
      // Parse as the chunks arrive so the live log follows the agent.
      const stream = createSseStream(makeSseSink(sessionId, runId, tc.id, step), redactOpts);
      if (response.response) {
        for await (const chunk of response.response) stream.write(new Uint8Array(Object.values(chunk)));
      }
      return stream.end();
    }
    // Local mode already showed text/tool events live via the onLine callback above;
    // parseSSE gets no step here so they are not shown twice.
    return parseSSE(rawText, sessionId, runId, tc.id);
  } catch (e) {
    return { passed: false, reason: redactSecrets(`Runtime error: ${e.message}`, currentSecrets()) };
  } finally {
    textOut.flush();   // end of stream: the last piece of text
  }
}

// Puts a redo run's cases on the feature's redo queue, which the loop serves before the run's own cases (the feature is running, see
// planRedo). They run in the same session right after the case in progress, or at once if the feature
// is held by a pause. Resolves when every case has run, been skipped or been cancelled.
export function enqueueRedo(feature, testCases, runId, onProgress, hints) {
  const queue = redoQueues.get(feature);
  return new Promise((resolve, reject) => {
    if (!queue) return reject(new Error(`${feature} is not running`));
    let left = testCases.length;
    const jobs = testCases.map(tc => ({ tc, runId, onProgress, hints, settle: () => { if (--left === 0) resolve(); } }));
    queue.push(...jobs);   // the redo queue is served before the run's own cases; first asked, first run
    for (const tc of testCases) broadcast({ type: 'redo_queued', feature, runId, testId: tc.id, hint: hints?.[tc.id]?.hint || '' });
  });
}

// Cancels a queued redo that has not started. Returns the job, or null if it already started (or never existed).
export function cancelRedo(feature, runId, tcId) {
  // runId and tcId come from the request: refuse keys that reach Object.prototype before any lookup.
  if (isUnsafeKey(runId) || isUnsafeKey(tcId)) return null;
  const job = takeQueuedRedo(feature, runId, tcId);
  if (!job) return null;
  if (Object.prototype.hasOwnProperty.call(testRuns, runId)) {
    const run = testRuns[runId];
    run.results[tcId] = { status: 'PENDING' };
    if (!run.cancelled) run.cancelled = Object.create(null);
    run.cancelled[tcId] = true;   // read by buildRunRecord and planRedo
  }
  broadcast({ type: 'redo_cancelled', feature, runId, testId: tcId });
  job.onProgress?.();
  job.settle();
  return job;
}

// hints: { [tcId]: { hint } } for a redo run; empty for a normal run.
export async function runFeatureTests(feature, testCases, runId, onProgress, hints = {}) {
  const sessionId = feature;
  activeFeatures.add(feature);
  // Redos queued onto this feature's loop (they go first); open from the start so one asked for while
  // the session is still connecting is not lost.
  const redos = [];
  redoQueues.set(feature, redos);
  try {
    await ensureSession(sessionId);
  } catch (e) {
    const failed = [...testCases.map(tc => ({ tc, runId, onProgress })), ...redos.splice(0)];
    for (const { tc, runId: rid, onProgress: onProg, settle } of failed) {
      // Error text can come from the runtime or the AWS SDK and may quote what it was sent: mask it.
      const msg = redactSecrets(e.message, currentSecrets());
      const failReason = `Session failed: ${msg}`;
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status: 'FAIL', reason: failReason, runId: rid });
      if (testRuns[rid]) testRuns[rid].results[tc.id] = { status: 'FAIL', reason: msg };
      saveTestResult(tc.id, 'FAIL', failReason);
      onProg?.();
      settle?.();
    }
    activeFeatures.delete(feature);
    redoQueues.delete(feature);
    clearPause(feature);
    return;
  }

  const mainRunId = runId;
  const todo = testCases.map(tc => ({ tc, runId, onProgress, hints }));
  let announced = false;   // "paused" was broadcast and "resumed" has not been yet
  let prev;
  for (;;) {
    prev?.settle?.(); prev = undefined;
    let job = redos.shift();
    if (!job) {
      // A human can pause one feature; it holds here, between test cases (a case already
      // running inside the agent can't be interrupted). Stop releases it, and so does a redo
      // (the feature stays paused: only "resumed" is not announced then).
      if (todo.length) {
        await holdWhilePaused(feature, () => stopFlags[mainRunId] || redos.length > 0, {
          onHold: () => { if (!announced) { announced = true; broadcast({ type: 'feature_paused', ...pauseState(feature), runId: mainRunId }); } },
          onRelease: () => {
            if (pausedFeatures.has(feature) && !stopFlags[mainRunId]) return;
            announced = false;
            broadcast({ type: 'feature_resumed', feature, runId: mainRunId });
          },
        });
      }
      job = redos.shift() || todo.shift();
      if (!job) break;
    }
    prev = job;
    const { tc, runId, hints, onProgress } = job;
    if (stopFlags[runId]) {
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'PENDING' };
      broadcast({ type: 'test_skipped', testId: tc.id, sessionId, runId });
      continue;
    }

    // What a pending pause waits for, and how many of this run's cases would still follow it.
    caseProgress.set(feature, { tcId: tc.id, startedAt: new Date().toISOString(), remaining: todo.length });
    broadcast({ type: 'test_start', testId: tc.id, sessionId, runId });
    if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'RUNNING' };

    const sess = sessions[sessionId];
    const label = config.agentMode === 'local' ? 'OpenCode (local)' : 'OpenCode (AgentCore)';
    if (sess) sess.action = `[${tc.id}] Running on ${label}...`;
    broadcast({ type: 'action', sessionId, text: `[${tc.id}] Invoking ${label}...`, testId: tc.id });

    // Pause the agentcore-mode screenshot poller for this feature while the
    // agent's own CDP connection is live — see the comment in
    // startAgentcoreScreenPoller (services/sessions.js) for why a second
    // concurrent connection to the same AgentCore Browser session 429s.
    if (sess) sess.testRunning = true;
    try {
      const result = await invokeRuntime(tc, runId, sessionId, hints[tc.id]?.hint);
      const status = result.passed ? 'PASS' : 'FAIL';
      result.reason = redactSecrets(result.reason, currentSecrets());
      // Upload buffered evidence frames to S3; tucked into testRuns so the
      // archive builder can pick them up when the run completes.
      const snapshots = await flushTcSnapshots(runId, tc.id);
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status, reason: result.reason, snapshots };
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status, reason: result.reason, runId });
      saveTestResult(tc.id, status, result.reason || '');
      console.log(`[${feature}] ${tc.id}: ${status} — ${(result.reason || '').slice(0, 80)} (${snapshots.length} snapshots)`);
    } catch (e) {
      const msg = redactSecrets(e.message, currentSecrets());   // error text may quote what was sent
      const snapshots = await flushTcSnapshots(runId, tc.id);
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'FAIL', reason: msg, snapshots };
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status: 'FAIL', reason: msg, runId });
      saveTestResult(tc.id, 'FAIL', msg);
    }
    if (sess) { sess.testRunning = false; sess.action = ''; }
    caseProgress.delete(feature);
    onProgress?.();
  }

  caseProgress.delete(feature);
  activeFeatures.delete(feature);
  redoQueues.delete(feature);
  clearPause(feature);
  broadcast({ type: 'feature_complete', feature: sessionId, runId });
}
