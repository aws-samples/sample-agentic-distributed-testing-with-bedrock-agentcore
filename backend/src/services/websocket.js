import { WebSocketServer } from 'ws';
import { config, moduleList, sessions, testResultsCache, testRuns, stopFlags, activeModules } from '../state/store.js';
import { authEnabled, verifyWsToken } from '../middleware/auth.js';

let wss;
const wsClients = new Set();

export function initWebSocket(server) {
  // noServer + a manual upgrade handler (instead of WebSocketServer's own
  // `path` option) so we can reject the handshake with a real HTTP status
  // before a socket is ever accepted, when a token is required and missing
  // or invalid. A browser WebSocket can't set an Authorization header, so
  // the token rides in the query string (see frontend authFetch.js
  // buildAuthedWsUrl) and is verified against the same Cognito user pool
  // used for /api/* — see middleware/auth.js.
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname !== '/ws') return; // let other upgrade listeners (if any) handle it

    if (authEnabled) {
      const token = searchParams.get('token') || '';
      const valid = await verifyWsToken(token);
      if (!valid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));

    // 1. Config
    ws.send(JSON.stringify({
      type: 'config',
      targetUrl: config.targetUrl,
      modules: moduleList,
      model: config.bedrockModel,
      agentMode: config.agentMode,
    }));

    // 2. Session state (screenshots + connection status)
    for (const [sid, sess] of Object.entries(sessions)) {
      if (sess.screenshot) {
        ws.send(JSON.stringify({ type: 'screenshot', sessionId: sid, data: sess.screenshot, action: sess.action || '' }));
      }
      ws.send(JSON.stringify({ type: 'session_status', sessionId: sid, connected: sess.connected, module: sid }));
    }

    // 3. Replay persisted test results so the UI restores status on reconnect.
    // Merge in any RUNNING TCs from in-flight runs so the Stop button
    // (driven by isRunning) reappears mid-run after a page refresh.
    const snapshot = { ...testResultsCache };
    let activeRunId = null;
    for (const [rid, run] of Object.entries(testRuns)) {
      if (stopFlags[rid]) continue;
      for (const [tcId, r] of Object.entries(run.results || {})) {
        if (r?.status === 'RUNNING') {
          snapshot[tcId] = { status: 'RUNNING' };
          activeRunId = rid;
        }
      }
    }

    const activeMods = Array.from(activeModules);
    if (Object.keys(snapshot).length > 0 || activeMods.length > 0) {
      ws.send(JSON.stringify({
        type: 'test_results_snapshot',
        results: snapshot,
        activeModules: activeMods,
        currentRunId: activeRunId,
      }));
    }
  });
}

export function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(str);
  }
}
