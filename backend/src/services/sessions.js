import { WebSocket as WS } from 'ws';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { Browser } from 'bedrock-agentcore/browser';
import { config, sessions, activeAborts } from '../state/store.js';
import { broadcast } from './websocket.js';

const LOCAL_URL = process.env.LOCAL_RUNTIME_URL || 'http://localhost:4020';

// Per-region client cache so we don't recreate the SDK client on every call,
// but still honour live region changes from Settings.
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

// ─── Screen polling (local mode) ─────────────────────────────────────────────
// Per-session poll interval handle for 2fps screenshot streaming
const screenPollers = {};

export function startScreenPoller(sessionId) {
  if (screenPollers[sessionId]) return;
  // Encode session name for URL — spaces → underscores
  const sessionParam = encodeURIComponent(sessionId.replace(/\s+/g, '_'));
  screenPollers[sessionId] = setInterval(async () => {
    if (!sessions[sessionId]) { stopScreenPoller(sessionId); return; }
    try {
      const resp = await fetch(`${LOCAL_URL}/screenshot?session=${sessionParam}`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return;
      const { data } = await resp.json();
      if (data && data !== sessions[sessionId]?.lastPolledScreenshot) {
        sessions[sessionId].lastPolledScreenshot = data;
        sessions[sessionId].screenshot = data;
        broadcast({ type: 'screenshot', sessionId, data, action: sessions[sessionId]?.action || '' });
      }
    } catch { /* ignore transient errors */ }
  }, 500);
}

export function stopScreenPoller(sessionId) {
  if (screenPollers[sessionId]) {
    clearInterval(screenPollers[sessionId]);
    delete screenPollers[sessionId];
  }
}

// ─── Screen polling (agentcore mode) ─────────────────────────────────────────
// grabLatestScreenshot opens a new signed WebSocket connection per call, so
// this polls slower than local mode's 500ms to avoid 429s across parallel
// modules.
const agentcoreScreenPollers = {};

export function startAgentcoreScreenPoller(sessionId) {
  if (agentcoreScreenPollers[sessionId]) return;
  agentcoreScreenPollers[sessionId] = setInterval(async () => {
    if (!sessions[sessionId]) { stopAgentcoreScreenPoller(sessionId); return; }
    await grabLatestScreenshot(sessionId, sessions[sessionId]?.browserSessionId);
  }, 2000);
}

export function stopAgentcoreScreenPoller(sessionId) {
  if (agentcoreScreenPollers[sessionId]) {
    clearInterval(agentcoreScreenPollers[sessionId]);
    delete agentcoreScreenPollers[sessionId];
  }
}

// ─── Local runtime invoke ─────────────────────────────────────────────────────

export async function invokeLocalRuntime(body, onLine) {
  const ctrl = new AbortController();
  activeAborts.add(ctrl);
  let resp;
  try {
    resp = await fetch(`${LOCAL_URL}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    activeAborts.delete(ctrl);
  } finally {
    activeAborts.delete(ctrl);
  }
  if (!resp.ok) throw new Error(`Local runtime HTTP ${resp.status}`);

  let rawText = '';
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of resp.body) {
    const text = decoder.decode(chunk, { stream: true });
    rawText += text;
    buf += text;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ') && onLine) onLine(line);
    }
  }
  if (buf.startsWith('data: ') && onLine) onLine(buf);
  return rawText;
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

export async function ensureSession(sessionId) {
  if (sessions[sessionId]?.connected) return;
  console.log(`[session] init ${sessionId} (mode=${config.agentMode})`);

  sessions[sessionId] = { connected: false, screenshot: null, action: 'Initializing...', browserSessionId: null };
  broadcast({ type: 'session_status', sessionId, connected: false, module: sessionId });

  const initPayload = {
    action: 'init',
    targetUrl: config.targetUrl || 'https://www.google.com',
    sessionName: sessionId.replace(/\s+/g, '_'),
  };

  try {
    let rawText = '';
    if (config.agentMode === 'local') {
      rawText = await invokeLocalRuntime(initPayload);
    } else {
      const sessId = `init-${sessionId.replace(/\s+/g, '_')}-${Date.now()}`.padEnd(33, '0');
      const cmd = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: getRuntimeArn(), qualifier: 'DEFAULT',
        runtimeSessionId: sessId,
        contentType: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(initPayload)),
      });
      const response = await getAgentCoreClient().send(cmd);
      if (response.response) {
        for await (const chunk of response.response) {
          rawText += new TextDecoder().decode(new Uint8Array(Object.values(chunk)));
        }
      }
    }

    // Collect text deltas too — the runtime reports its own failure reason
    // via emitText() as a JSON string ({status:'error', error: '...'}).
    const textDeltas = [];
    for (const line of rawText.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6))?.event;
        if (ev?.screenshot?.data) {
          sessions[sessionId].screenshot = ev.screenshot.data;
          broadcast({ type: 'screenshot', sessionId, data: ev.screenshot.data, action: '' });
        }
        const text = ev?.contentBlockDelta?.delta?.text;
        if (text) {
          textDeltas.push(text);
          try {
            const parsed = JSON.parse(text);
            if (parsed?.browserSessionId) sessions[sessionId].browserSessionId = parsed.browserSessionId;
          } catch { /* not JSON, ignore */ }
        }
      } catch { /* skip */ }
    }

    const ok = !!sessions[sessionId].screenshot;
    sessions[sessionId].connected = ok;
    sessions[sessionId].action = '';
    broadcast({ type: 'session_status', sessionId, connected: ok, module: sessionId });
    if (!ok) {
      let runtimeError = null;
      for (const text of textDeltas) {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.error) runtimeError = parsed.error;
        } catch { /* not JSON, ignore */ }
      }
      const detail = runtimeError || (textDeltas.length ? textDeltas.join(' | ') : 'no response text from runtime');
      throw new Error(`No screenshot received from runtime: ${detail}`);
    }
    // Start live-view polling for screenshot updates
    if (config.agentMode === 'local') startScreenPoller(sessionId);
    else startAgentcoreScreenPoller(sessionId);
  } catch (e) {
    console.error(`[session] init failed for ${sessionId}:`, e.message);
    sessions[sessionId] = { ...sessions[sessionId], connected: false, action: '' };
    broadcast({ type: 'session_status', sessionId, connected: false, module: sessionId });
    throw e;
  }
}

export async function killSession(sessionId) {
  stopScreenPoller(sessionId);
  stopAgentcoreScreenPoller(sessionId);
  const sess = sessions[sessionId];
  if (!sess) return;
  try { if (sess.ws) sess.ws.close(); } catch { /* ignore */ }
  delete sessions[sessionId];
  broadcast({ type: 'session_status', sessionId, connected: false, module: sessionId });
}

export async function grabLatestScreenshot(moduleId, browserSessionId) {
  try {
    // Must attach the specific session this module's browser is using — an
    // unscoped listSessions()[0] would grab an arbitrary READY session,
    // liable to show one module's live view sourced from a completely
    // different module's browser tab when several run in parallel.
    if (!browserSessionId) return;
    const browser = new Browser({ region: config.browserRegion });
    browser.attachSession(browserSessionId);
    const { url, headers } = await browser.generateWebSocketUrl();
    const ws = new WS(url, { headers });
    await new Promise((resolve, reject) => {
      let nextId = 1;
      function send(method, params = {}, cdpSessionId) {
        const id = nextId++;
        const msg = { id, method, params };
        if (cdpSessionId) msg.sessionId = cdpSessionId;
        ws.send(JSON.stringify(msg));
        return id;
      }
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
      const pending = {}; // id → what we're waiting for
      ws.on('open', () => {
        pending[send('Target.getTargets')] = 'getTargets';
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        const waitingFor = pending[msg.id];
        // AgentCore Browser's CDP endpoint is a real multi-target browser —
        // target-scoped methods like Page.captureScreenshot need
        // Target.attachToTarget first (see agent-runtime-agentcore/app/src/
        // index.js's agentCoreScreenshot, same handshake).
        if (waitingFor === 'getTargets') {
          delete pending[msg.id];
          const pageTarget = msg.result?.targetInfos?.find(t => t.type === 'page');
          if (!pageTarget) { clearTimeout(timeout); ws.close(); reject(new Error('no page target found')); return; }
          pending[send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })] = 'attach';
        } else if (waitingFor === 'attach') {
          delete pending[msg.id];
          const cdpSessionId = msg.result?.sessionId;
          if (!cdpSessionId) { clearTimeout(timeout); ws.close(); reject(new Error('attach returned no sessionId')); return; }
          send('Page.enable', {}, cdpSessionId);
          setTimeout(() => {
            pending[send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, cdpSessionId)] = 'screenshot';
          }, 500);
        } else if (waitingFor === 'screenshot') {
          delete pending[msg.id];
          clearTimeout(timeout);
          ws.close();
          if (msg.result?.data) {
            const sess = sessions[moduleId];
            if (sess) { sess.screenshot = msg.result.data; broadcast({ type: 'screenshot', sessionId: moduleId, data: msg.result.data, action: sess.action || '' }); }
            resolve();
          } else {
            reject(new Error(`screenshot failed: ${JSON.stringify(msg.error || msg)}`));
          }
        }
      });
      ws.on('error', e => { clearTimeout(timeout); reject(e); });
    });
  } catch (e) { console.error(`[screenshot] ${moduleId}:`, e.message); }
}
