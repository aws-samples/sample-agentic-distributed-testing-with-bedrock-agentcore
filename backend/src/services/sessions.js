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
        payload: new TextEncoder().encode(JSON.stringify(initPayload)),
      });
      const response = await getAgentCoreClient().send(cmd);
      if (response.response) {
        for await (const chunk of response.response) {
          rawText += new TextDecoder().decode(new Uint8Array(Object.values(chunk)));
        }
      }
    }

    for (const line of rawText.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const ev = JSON.parse(line.slice(6))?.event;
        if (ev?.screenshot?.data) {
          sessions[sessionId].screenshot = ev.screenshot.data;
          broadcast({ type: 'screenshot', sessionId, data: ev.screenshot.data, action: '' });
        }
      } catch { /* skip */ }
    }

    const ok = !!sessions[sessionId].screenshot;
    sessions[sessionId].connected = ok;
    sessions[sessionId].action = '';
    broadcast({ type: 'session_status', sessionId, connected: ok, module: sessionId });
    if (!ok) throw new Error('No screenshot received from runtime');
    // Start 2fps polling for live screenshot updates (local mode only)
    if (config.agentMode === 'local') startScreenPoller(sessionId);
  } catch (e) {
    console.error(`[session] init failed for ${sessionId}:`, e.message);
    sessions[sessionId] = { ...sessions[sessionId], connected: false, action: '' };
    broadcast({ type: 'session_status', sessionId, connected: false, module: sessionId });
    throw e;
  }
}

export async function killSession(sessionId) {
  stopScreenPoller(sessionId);
  const sess = sessions[sessionId];
  if (!sess) return;
  try { if (sess.ws) sess.ws.close(); } catch { /* ignore */ }
  delete sessions[sessionId];
  broadcast({ type: 'session_status', sessionId, connected: false, module: sessionId });
}

export async function grabLatestScreenshot(moduleId) {
  try {
    const browser = new Browser({ region: config.browserRegion });
    const { items } = await browser.listSessions({ status: 'READY' });
    if (!items?.length) return;
    const latest = items[0];
    browser.attachSession(latest.sessionId);
    const { url, headers } = await browser.generateWebSocketUrl();
    const ws = new WS(url, { headers });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Page.enable', params: {} }));
        setTimeout(() => ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 50 } })), 500);
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === 2 && msg.result?.data) {
          clearTimeout(timeout);
          const sess = sessions[moduleId];
          if (sess) { sess.screenshot = msg.result.data; broadcast({ type: 'screenshot', sessionId: moduleId, data: msg.result.data, action: sess.action || '' }); }
          ws.close(); resolve();
        }
      });
      ws.on('error', e => { clearTimeout(timeout); reject(e); });
    });
  } catch (e) { console.error(`[screenshot] ${moduleId}:`, e.message); }
}
