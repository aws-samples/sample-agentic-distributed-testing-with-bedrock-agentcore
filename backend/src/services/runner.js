import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { config, sessions, testRuns, stopFlags, runLogs, saveTestResult, activeFeatures, featureDescriptions } from '../state/store.js';
import { broadcast } from './websocket.js';
import { ensureSession, invokeLocalRuntime, makeRuntimeSessionId } from './sessions.js';
import { recordFrame, flushTcSnapshots } from './snapshots.js';

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

function parseSSE(rawText, sessionId, runId, tcId, logEntry) {
  const textParts = [];
  let assertResult = null;

  for (const line of rawText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const ev = JSON.parse(line.slice(6))?.event;
      if (!ev) continue;

      if (ev.screenshot?.data) {
        const sess = sessions[sessionId];
        if (sess) { sess.screenshot = ev.screenshot.data; broadcast({ type: 'screenshot', sessionId, data: ev.screenshot.data, action: sess.action || '' }); }
        if (runId && tcId) recordFrame(runId, tcId, ev.screenshot.data, sess?.action);
        continue;
      }

      const imgSource = ev.contentBlockStart?.start?.image?.source;
      if (imgSource?.type === 'base64' && imgSource.data) {
        const sess = sessions[sessionId];
        if (sess) { sess.screenshot = imgSource.data; broadcast({ type: 'screenshot', sessionId, data: imgSource.data, action: sess.action || '' }); }
        if (runId && tcId) recordFrame(runId, tcId, imgSource.data, sess?.action);
      }

      const textDelta = ev.contentBlockDelta?.delta?.text;
      if (textDelta) { textParts.push(textDelta); broadcast({ type: 'step_detail', sessionId, action: textDelta, kind: 'text' }); logEntry?.(textDelta, 'text'); }

      const toolStart = ev.contentBlockStart?.start?.toolUse;
      if (toolStart?.name && toolStart.name !== 'assert_pass' && toolStart.name !== 'assert_fail') {
        broadcast({ type: 'step_detail', sessionId, action: `→ ${toolStart.name}`, kind: 'tool' });
        logEntry?.(`→ ${toolStart.name}`, 'tool');
      }
      if (toolStart?.name === 'assert_pass') assertResult = { passed: true, reason: '' };
      else if (toolStart?.name === 'assert_fail') assertResult = { passed: false, reason: '' };

      const inputDelta = ev.contentBlockDelta?.delta?.toolUse?.input;
      if (inputDelta && assertResult) assertResult.reason += inputDelta;
    } catch { /* skip */ }
  }

  if (assertResult) {
    try { const p = JSON.parse(assertResult.reason); assertResult.reason = p.reason || assertResult.reason; } catch { /* keep raw */ }
    return assertResult;
  }

  const text = textParts.join('');
  if (!text) return { passed: false, reason: 'No result from runtime' };
  try {
    const m = text.match(/\{"passed"\s*:\s*(true|false)[^}]*\}/);
    if (m) { const p = JSON.parse(m[0]); return { passed: p.passed, reason: p.reason || text.slice(-200) }; }
  } catch { /* ignore */ }
  const tail = text.slice(-500).toLowerCase();
  if (tail.includes('pass') || tail.includes('success') || tail.includes('verified')) return { passed: true, reason: text.slice(-200) };
  return { passed: false, reason: text.slice(-200) };
}

export async function invokeRuntime(tc, runId, sessionId) {
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
  if (!runLogs[runId]) runLogs[runId] = {};
  if (!runLogs[runId][tc.id]) runLogs[runId][tc.id] = [];
  const tcLog = runLogs[runId][tc.id];

  const logEntry = (msg, kind = 'info') => {
    tcLog.push({ ts: new Date().toLocaleTimeString(), msg, kind });
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
          if (t) { broadcast({ type: 'step_detail', sessionId, action: t, kind: 'text' }); logEntry(t, 'text'); }
          const tool = ev.contentBlockStart?.start?.toolUse?.name;
          if (tool) { broadcast({ type: 'step_detail', sessionId, action: `→ ${tool}`, kind: 'tool' }); logEntry(`→ ${tool}`, 'tool'); }
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
      if (response.response) for await (const chunk of response.response) rawText += new TextDecoder().decode(new Uint8Array(Object.values(chunk)));
    }
    // Local mode already logged text/tool events live via the onLine callback above;
    // only pass logEntry here for agentcore mode, where parseSSE is the sole log source.
    return parseSSE(rawText, sessionId, runId, tc.id, config.agentMode === 'local' ? null : logEntry);
  } catch (e) {
    return { passed: false, reason: `Runtime error: ${e.message}` };
  }
}

export async function runFeatureTests(feature, testCases, runId, onProgress) {
  const sessionId = feature;
  activeFeatures.add(feature);
  try {
    await ensureSession(sessionId);
  } catch (e) {
    for (const tc of testCases) {
      const failReason = `Session failed: ${e.message}`;
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status: 'FAIL', reason: failReason, runId });
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'FAIL', reason: e.message };
      saveTestResult(tc.id, 'FAIL', failReason);
    }
    onProgress?.();
    activeFeatures.delete(feature);
    return;
  }

  for (const tc of testCases) {
    if (stopFlags[runId]) {
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'PENDING' };
      broadcast({ type: 'test_skipped', testId: tc.id, sessionId, runId });
      continue;
    }

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
      const result = await invokeRuntime(tc, runId, sessionId);
      const status = result.passed ? 'PASS' : 'FAIL';
      // Upload buffered evidence frames to S3; tucked into testRuns so the
      // archive builder can pick them up when the run completes.
      const snapshots = await flushTcSnapshots(runId, tc.id);
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status, reason: result.reason, snapshots };
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status, reason: result.reason, runId });
      saveTestResult(tc.id, status, result.reason || '');
      console.log(`[${feature}] ${tc.id}: ${status} — ${(result.reason || '').slice(0, 80)} (${snapshots.length} snapshots)`);
    } catch (e) {
      const snapshots = await flushTcSnapshots(runId, tc.id);
      if (testRuns[runId]) testRuns[runId].results[tc.id] = { status: 'FAIL', reason: e.message, snapshots };
      broadcast({ type: 'test_result', testId: tc.id, sessionId, status: 'FAIL', reason: e.message, runId });
      saveTestResult(tc.id, 'FAIL', e.message);
    }
    if (sess) { sess.testRunning = false; sess.action = ''; }
    onProgress?.();
  }

  activeFeatures.delete(feature);
  broadcast({ type: 'feature_complete', feature: sessionId, runId });
}
