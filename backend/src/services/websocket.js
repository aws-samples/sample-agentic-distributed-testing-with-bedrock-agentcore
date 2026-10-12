import { WebSocketServer } from 'ws';
import { config, featureList, sessions, testResultsCache, testRuns, stopFlags, activeFeatures } from '../state/store.js';
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
      features: featureList,
      model: config.bedrockModel,
      agentMode: config.agentMode,
    }));

    // 2. Session state (screenshots + connection status)
    for (const [sid, sess] of Object.entries(sessions)) {
      if (sess.screenshot) {
        ws.send(JSON.stringify({ type: 'screenshot', sessionId: sid, data: sess.screenshot, action: sess.action || '' }));
      }
      ws.send(JSON.stringify({ type: 'session_status', sessionId: sid, connected: sess.connected, feature: sid }));
    }

    // 3. Replay persisted test results so the UI restores status on reconnect.
    // Merge in any RUNNING TCs from in-flight runs — including ones already
    // stopping (stopFlags set but features still finishing their current test
    // case) — so the Stop/Stopping state reappears correctly after a page
    // refresh instead of silently reverting to idle.
    const snapshot = { ...testResultsCache };
    let activeRunId = null;
    let activeRunStopping = false;
    for (const [rid, run] of Object.entries(testRuns)) {
      for (const [tcId, r] of Object.entries(run.results || {})) {
        if (r?.status === 'RUNNING') {
          snapshot[tcId] = { status: 'RUNNING' };
          activeRunId = rid;
          if (stopFlags[rid]) activeRunStopping = true;
        }
      }
    }

    const activeFeats = Array.from(activeFeatures);
    if (Object.keys(snapshot).length > 0 || activeFeats.length > 0) {
      ws.send(JSON.stringify({
        type: 'test_results_snapshot',
        results: snapshot,
        activeFeatures: activeFeats,
        currentRunId: activeRunId,
        stopping: activeRunStopping,
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
