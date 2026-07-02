/**
 * Agent Runtime — OpenCode-based test execution server.
 *
 * Replaces the Strands/AgentCore Python runtime with a Node.js HTTP server
 * that shells out to `opencode run --format json`.
 *
 * POST / with JSON body { action, testCase?, targetUrl } responds with
 * newline-delimited SSE-compatible JSON events (same protocol as the old
 * AgentCore Runtime so the backend orchestrator needs no structural changes).
 *
 * Verdict detection: a tiny MCP stdio server (assert-server.js) exposes
 * assert_pass / assert_fail tools. opencode calls them, the server writes
 * the verdict to a temp file, and we read it after the run completes.
 */

import express from 'express';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, unlinkSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSERT_SERVER = join(__dirname, 'assert-server.js');

const PORT = process.env.PORT || 4020;
// opencode uses Bedrock converse-stream; us-east-1 has the broadest model availability
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
// opencode model format: amazon-bedrock/<model-id>
// Use us. cross-region inference profile in us-east-1
const BEDROCK_MODEL_RAW = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
// BEDROCK_MODEL_RAW is shared with the backend container (same env var,
// bare model ID with no provider prefix — see docker-compose.yml/.env), but
// opencode's own config schema requires "amazon-bedrock/<model-id>". Add
// the prefix here rather than assuming callers already included it —
// without it, opencode fails immediately with a swallowed
// ProviderModelNotFoundError and every test case reports "No verdict from
// agent" with no further explanation.
const BEDROCK_MODEL = BEDROCK_MODEL_RAW.startsWith('amazon-bedrock/')
  ? BEDROCK_MODEL_RAW
  : `amazon-bedrock/${BEDROCK_MODEL_RAW}`;
const CHROME_DEVTOOLS_URL = process.env.CHROME_DEVTOOLS_URL || '';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Persistent Chromium ──────────────────────────────────────────────────────
// We launch one shared Chromium instance that opencode connects to.
// All sessions share this browser so screenshots can be polled at any time.

const CHROME_CDP_PORT = 9222;
let chromiumProc = null;

function startChromium() {
  const args = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--headless=new',
    `--remote-debugging-port=${CHROME_CDP_PORT}`,
    `--remote-debugging-address=0.0.0.0`,
    '--window-size=1024,768',
    '--user-data-dir=/tmp/chrome-profile',
    'about:blank',
  ];
  chromiumProc = spawn('/usr/bin/chromium', args, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false,
  });
  chromiumProc.on('exit', (code) => {
    console.log(`[chromium] exited (${code}), restarting in 2s...`);
    setTimeout(startChromium, 2000);
  });
  console.log(`[chromium] started pid=${chromiumProc.pid} cdp=localhost:${CHROME_CDP_PORT}`);
}

// Wait for Chromium CDP to be ready
async function waitForChromium(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${CHROME_CDP_PORT}/json/version`, (r) => resolve(r))
            .on('error', reject);
      });
      console.log('[chromium] CDP ready');
      return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('[chromium] CDP not ready after retries');
  return false;
}

// ─── Per-session tab management ───────────────────────────────────────────────
// One dedicated Chromium tab per session (module). Keyed by session name.
const sessionTabs = {};   // sessionName → { targetId, wsUrl }

async function cdpHttp(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CHROME_CDP_PORT}${path}`, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function cdpPost(path, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost', port: CHROME_CDP_PORT,
      path, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Get the browser-level WebSocket URL (for connecting chrome-devtools-mcp). */
let browserWsUrl = null;
async function getBrowserWsUrl() {
  if (browserWsUrl) return browserWsUrl;
  const version = await cdpHttp('/json/version');
  browserWsUrl = version.webSocketDebuggerUrl;
  return browserWsUrl;
}

/** Get or create a dedicated tab for this session. Returns { wsUrl, pageNum }. */
async function getOrCreateTab(sessionName) {
  const targets = await cdpHttp('/json');
  const pages = targets.filter(t => t.type === 'page');

  // Check if we already have a tab and it still exists
  if (sessionTabs[sessionName]) {
    const alive = pages.find(t => t.id === sessionTabs[sessionName].targetId);
    if (alive) {
      // Recalculate page number (may change if tabs are closed/opened)
      const pageNum = pages.indexOf(alive) + 1;
      sessionTabs[sessionName].pageNum = pageNum;
      return sessionTabs[sessionName];
    }
  }

  // Create a new tab
  const target = await cdpPost('/json/new?about:blank');
  if (!target?.id) throw new Error('Failed to create CDP tab');
  // Fetch updated list to get page number
  const newTargets = await cdpHttp('/json');
  const newPages = newTargets.filter(t => t.type === 'page');
  const pageNum = newPages.findIndex(t => t.id === target.id) + 1;
  sessionTabs[sessionName] = { targetId: target.id, wsUrl: target.webSocketDebuggerUrl, pageNum };
  console.log(`[tab] created for session="${sessionName}" id=${target.id} pageNum=${pageNum}`);
  return sessionTabs[sessionName];
}

/** Close the tab for this session. */
async function closeTab(sessionName) {
  const tab = sessionTabs[sessionName];
  if (!tab) return;
  try {
    await new Promise((resolve, reject) => {
      http.get(`http://localhost:${CHROME_CDP_PORT}/json/close/${tab.targetId}`, () => resolve())
          .on('error', reject);
    });
  } catch { /* ignore */ }
  delete sessionTabs[sessionName];
  console.log(`[tab] closed for session="${sessionName}"`);
}

/** Navigate a session's tab to a URL via CDP and wait for load. */
async function cdpNavigate(sessionName, url) {
  const tabData = await getOrCreateTab(sessionName); const wsUrl = tabData?.wsUrl || tabData;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.terminate(); resolve(); }, 10000);
    let navigated = false;

    ws.once('open', () => {
      // Enable Page events so we can detect load
      ws.send(JSON.stringify({ id: 1, method: 'Page.enable' }));
      ws.send(JSON.stringify({ id: 2, method: 'Page.navigate', params: { url } }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        // Wait for Page.loadEventFired or the navigate response
        if (msg.method === 'Page.loadEventFired' || (msg.id === 2 && msg.result)) {
          if (!navigated) {
            navigated = true;
            clearTimeout(timeout);
            // Small pause for page to render
            setTimeout(() => { ws.close(); resolve(); }, 800);
          }
        }
      } catch { /* ignore */ }
    });

    ws.on('error', (e) => { clearTimeout(timeout); resolve(); });
  });
}

/** Re-sync session tab to the tab that was most recently active (in case agent opened a new one). */
async function resyncSessionTab(sessionName) {
  try {
    const targets = await cdpHttp('/json');
    const pages = targets.filter(t => t.type === 'page');
    if (!pages.length) return;
    // If our stored tab is in the list, keep it; otherwise use the last one
    const stored = sessionTabs[sessionName];
    const stillAlive = stored && pages.find(t => t.id === stored.targetId);
    if (!stillAlive && pages.length > 0) {
      const newest = pages[pages.length - 1];
      sessionTabs[sessionName] = { targetId: newest.id, wsUrl: newest.webSocketDebuggerUrl };
      console.log(`[tab] resynced session="${sessionName}" to id=${newest.id}`);
    }
  } catch { /* ignore */ }
}

/** Take a JPEG screenshot of the given session's tab. */
async function cdpScreenshot(sessionName) {
  const tab = await getOrCreateTab(sessionName);
  const wsUrl = tab?.wsUrl || tab;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('CDP screenshot timeout')); }, 5000);

    ws.once('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Page.captureScreenshot',
        params: { format: 'jpeg', quality: 65, captureBeyondViewport: false },
      }));
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      ws.close();
      try {
        const msg = JSON.parse(data);
        if (msg.result?.data) resolve(msg.result.data);
        else reject(new Error('No screenshot data in CDP response'));
      } catch (e) { reject(e); }
    });

    ws.on('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// GET /screenshot?session=<name> — returns { data: '<base64 jpeg>' }
// Backend polls this at ~2fps per active session.
app.get('/screenshot', async (req, res) => {
  const sessionName = req.query.session || 'default';
  try {
    const data = await cdpScreenshot(sessionName);
    res.json({ data });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// DELETE /session/:name — closes the tab for that session
app.delete('/session/:name', async (req, res) => {
  await closeTab(req.params.name);
  res.json({ ok: true });
});

// ─── AWS credentials from IMDS (EC2 instance profile) ────────────────────────

let cachedCreds = null;
let credsExpiry = 0;

async function fetchImdsToken() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '169.254.169.254',
      path: '/latest/api/token',
      method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
      timeout: 2000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim()));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

async function fetchImdsUrl(path, token) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '169.254.169.254',
      path,
      headers: token ? { 'X-aws-ec2-metadata-token': token } : {},
      timeout: 2000,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim()));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

async function getAwsCredentials() {
  if (cachedCreds && Date.now() < credsExpiry) return cachedCreds;

  try {
    const token = await fetchImdsToken();
    const role = await fetchImdsUrl('/latest/meta-data/iam/security-credentials/', token);
    if (!role) return null;
    const raw = await fetchImdsUrl(`/latest/meta-data/iam/security-credentials/${role}`, token);
    const creds = JSON.parse(raw);
    cachedCreds = {
      AWS_ACCESS_KEY_ID: creds.AccessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.SecretAccessKey,
      AWS_SESSION_TOKEN: creds.Token,
    };
    // Refresh 5 minutes before expiry
    const expiryMs = new Date(creds.Expiration).getTime();
    credsExpiry = expiryMs - 5 * 60 * 1000;
    return cachedCreds;
  } catch {
    return null;
  }
}

// ─── Config & prompt builders ─────────────────────────────────────────────────

function buildSystemPrompt(tc, targetUrl, pageNum, auth) {
  const steps = (tc.steps || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  const expectedLines = (Array.isArray(tc.expectedResult) ? tc.expectedResult : [tc.expectedResult])
    .filter(Boolean).map((e, i) => `  ${i + 1}. ${e}`).join('\n');
  const pageInstruction = pageNum
    ? `\nBROWSER PAGE: You have been assigned page #${pageNum}. When calling browser tools, always include "pageId": ${pageNum} in your arguments to target the correct browser tab.`
    : '';
  const authSection = (auth && auth.username) ? `

AUTHENTICATION CREDENTIALS:
This application requires authentication. Use these credentials whenever a login form, sign-in prompt, or authentication challenge appears — even if the test case does not explicitly mention them:
- Username: ${auth.username}
- Password: ${auth.password}
If you are not already logged in when you reach the page needed for this test, log in first using the credentials above, then proceed with the test steps.` : '';

  return `You are an expert QA automation engineer testing a web application.

TARGET URL: ${targetUrl}
IMPORTANT: Always start by navigating to ${targetUrl}. Ignore any URLs mentioned in the test steps — use ONLY ${targetUrl} as the starting point.${pageInstruction}${authSection}

RULES:
1. Navigate to ${targetUrl} first using pageId: ${pageNum || 1}, then follow the test steps
2. ALWAYS include "pageId": ${pageNum || 1} in every browser tool call
3. Do NOT call new_page or open new tabs — use your assigned page only
4. Use browser tools to interact with the page (click, type, scroll, read)
5. EVIDENCE SCREENSHOTS — these are required so reviewers can audit your verdict:
   a. Take a screenshot AFTER landing on the target URL (initial state)
   b. Take a screenshot AFTER each significant action (login submitted, form submitted, navigation completed, important state change)
   c. ALWAYS take a final screenshot RIGHT BEFORE calling assert_pass or assert_fail — this is the evidence that supports your verdict
   d. WAIT FOR THE PAGE TO FULLY RENDER before each screenshot — the page text/UI must be visible, no loading spinners, no blank/white intermediate state. If you see a blank or partially-loaded page, wait briefly and take another screenshot. NEVER submit a blank screenshot as evidence.
6. In your assert_pass / assert_fail reason, REFERENCE what is visible in the final screenshot (e.g. "Dashboard shows welcome message for user X" or "Login form shows error: invalid credentials")
7. Call assert_pass or assert_fail EXACTLY ONCE when done, then stop
8. If a step says "navigate to <url>", treat it as navigating to ${targetUrl}

Test Case:
- ID: ${tc.id || ''}
- Module: ${tc.module || ''}
- Title: ${tc.title || ''}
- Steps:
${steps}
- Expected Result:
${expectedLines}`;
}

/**
 * Build the opencode JSON config that wires up:
 *  - assert-server MCP (assert_pass / assert_fail tools)
 *  - chrome-devtools-mcp (browser tools)
 *  - Bedrock provider with region
 *
 * Correct opencode config schema:
 *  - mcp.*.command is an ARRAY (command + args together)
 *  - mcp.*.environment (not env) for env vars
 *  - provider (not providers) for provider config
 *  - model is "amazon-bedrock/<model-id>" format
 */
function buildOpencodeConfig(assertResultFile, browserWs) {
  // Connect to the browser-level WebSocket so chrome-devtools-mcp can call
  // browser-level commands (Target.getBrowserContexts, etc.).
  // Individual page routing is handled via pageId in tool calls.
  const wsEndpoint = browserWs || (CHROME_DEVTOOLS_URL || `http://localhost:${CHROME_CDP_PORT}`);
  const chromeMcpArgs = wsEndpoint.startsWith('ws')
    ? [`--wsEndpoint=${wsEndpoint}`, '--experimentalPageIdRouting']
    : [`--browser-url=${wsEndpoint}`, '--experimentalPageIdRouting'];

  return {
    $schema: 'https://opencode.ai/config.json',
    model: BEDROCK_MODEL,
    provider: {
      'amazon-bedrock': {
        options: {
          region: BEDROCK_REGION,
        },
      },
    },
    // Disable new_page so the agent stays in its assigned tab
    tools: {
      'chrome-devtools_new_page': false,
      'chrome-devtools_close_page': false,
    },
    mcp: {
      assert: {
        type: 'local',
        command: ['node', ASSERT_SERVER],
        environment: { ASSERT_RESULT_FILE: assertResultFile },
      },
      'chrome-devtools': {
        type: 'local',
        // Use globally-installed binary (avoids npx download on every run)
        command: [
          'chrome-devtools-mcp',
          '--screenshotFormat=jpeg',
          '--no-usage-statistics',
          ...chromeMcpArgs,
        ],
      },
    },
  };
}

// ─── OpenCode runner ──────────────────────────────────────────────────────────

/**
 * Run opencode non-interactively and stream parsed events back.
 * Calls onEvent(eventObj) for each JSON event from opencode --format json.
 * Returns { passed, reason } verdict from assert tool call.
 *
 * opencode --format json event types (verified against v1.17.x):
 *   { type: 'step_start', ... }
 *   { type: 'text', part: { type: 'text', text: '...' } }
 *   { type: 'tool_use', part: { tool: '<name>', state: { input, output, ... } } }
 *   { type: 'step_finish', ... }
 *   { type: 'error', error: { ... } }
 */
// Track all running opencode child processes so /kill can terminate them
const activeChildren = new Set();

async function runOpencode(prompt, workDir, assertResultFile, onEvent, browserWs) {
  const configPath = join(workDir, 'opencode.json');
  const config = buildOpencodeConfig(assertResultFile, browserWs);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  // Log auth presence (but never the password) so operators can verify
  // the agent received credentials when authentication is enabled
  const authMatch = prompt.match(/AUTHENTICATION CREDENTIALS:.*?\n- Username: ([^\n]+)/s);
  if (authMatch) console.log(`[prompt] auth context attached, username=${authMatch[1]}`);
  // Fetch AWS credentials from IMDS so opencode can call Bedrock
  const awsCreds = await getAwsCredentials();

  return new Promise((resolve) => {
    const child = spawn(
      'opencode',
      // --dir explicitly sets the project root so opencode doesn't walk up to /app
      ['run', '--format', 'json', '--dangerously-skip-permissions', '--dir', workDir, prompt],
      {
        cwd: workDir,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/root',
          PATH: process.env.PATH,
          AWS_DEFAULT_REGION: BEDROCK_REGION,
          OPENCODE_CONFIG: configPath,
          ...(awsCreds || {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    activeChildren.add(child);

    let buf = '';
    let resolved = false;

    function tryResolve(verdict) {
      if (resolved) return;
      resolved = true;
      // Kill the child after assert — prevents double-run summary loop
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      activeChildren.delete(child);
      resolve(verdict);
    }

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          onEvent(ev);
          // Detect assert tool completion in the stream and resolve immediately.
          // opencode emits tool_use events with state.status='completed' when done.
          if (ev.type === 'tool_use' && ev.part?.state?.status === 'completed') {
            const tool = ev.part?.tool || '';
            if (tool === 'assert_assert_pass' || tool === 'assert_assert_fail') {
              const output = ev.part.state.output || '{}';
              let verdict = null;
              try { verdict = JSON.parse(output); } catch { /* ignore */ }
              if (!verdict) {
                verdict = {
                  passed: tool === 'assert_assert_pass',
                  reason: ev.part.state.input?.reason || '',
                };
              }
              tryResolve(verdict);
            }
          }
        } catch { /* skip */ }
      }
    });

    child.stderr.on('data', (d) => {
      onEvent({ type: 'log', text: d.toString() });
    });

    child.on('close', () => {
      activeChildren.delete(child);
      if (resolved) return;
      if (buf.trim()) {
        try { onEvent(JSON.parse(buf)); } catch { /* ignore */ }
      }
      // Fall back to reading verdict file if stream detection missed it
      let verdict = null;
      try {
        if (existsSync(assertResultFile)) {
          verdict = JSON.parse(readFileSync(assertResultFile, 'utf8'));
          unlinkSync(assertResultFile);
        }
      } catch { /* ignore */ }
      tryResolve(verdict);
    });

    child.on('error', (e) => {
      activeChildren.delete(child);
      onEvent({ type: 'error', text: e.message });
      tryResolve(null);
    });
  });
}

/**
 * Extract screenshot base64 from an opencode tool_use event.
 *
 * chrome-devtools-mcp take_screenshot stores the image in
 * part.state.attachments[].url as a data URI:
 *   { type: 'file', mime: 'image/png', url: 'data:image/png;base64,<data>' }
 *
 * Falls back to checking output string for raw base64 or JSON.
 */
function extractScreenshot(ev) {
  if (ev.type !== 'tool_use') return null;
  const state = ev.part?.state;
  if (!state) return null;

  // Primary path: attachments array (chrome-devtools-mcp 2.x)
  if (Array.isArray(state.attachments)) {
    for (const att of state.attachments) {
      if (att?.mime?.startsWith('image/') && att?.url) {
        // Strip data URI prefix to get raw base64
        const match = att.url.match(/^data:[^;]+;base64,(.+)$/);
        if (match) return match[1];
      }
    }
  }

  // Fallback: output string
  if (typeof state.output === 'string') {
    // Raw base64 JPEG or PNG
    if (state.output.startsWith('/9j/') || state.output.startsWith('iVBOR')) {
      return state.output;
    }
    // JSON-encoded image
    try {
      const parsed = JSON.parse(state.output);
      if (parsed?.image) return parsed.image;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.type === 'image' && item?.data) return item.data;
        }
      }
    } catch { /* not JSON */ }
  }

  return null;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'opencode', region: BEDROCK_REGION, model: BEDROCK_MODEL_RAW });
});

/**
 * Main entrypoint — mirrors the AgentCore Runtime SSE protocol.
 * Request: { action: 'init'|'run_test'|'health', testCase?, targetUrl }
 * Response: SSE lines — data: {"event": {...}}
 */
app.post('/', async (req, res) => {
  const { action = 'run_test', testCase: tc, targetUrl, sessionName, auth } = req.body;
  if (action === 'run_test') {
    console.log(`[runtime] run_test session=${sessionName} tc=${tc?.id} auth=${auth?.username ? 'yes:' + auth.username : 'no'}`);
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function emit(event) {
    res.write('data: ' + JSON.stringify({ event }) + '\n\n');
  }
  function emitText(text) {
    emit({ contentBlockDelta: { delta: { text } } });
  }

  if (action === 'health') {
    emitText(JSON.stringify({ status: 'ok', region: BEDROCK_REGION }));
    res.end();
    return;
  }

  let workDir;
  try {
    workDir = mkdtempSync(join(tmpdir(), 'ocrunt-'));
  } catch (e) {
    emitText(JSON.stringify({ error: 'Failed to create workdir: ' + e.message }));
    res.end();
    return;
  }

  const assertResultFile = join(workDir, 'verdict.json');

  // Ensure this session has its own dedicated tab
  const tabName = sessionName || 'default';
  let tabInfo = null;
  let browserWs = null;
  try {
    tabInfo = await getOrCreateTab(tabName);
    browserWs = await getBrowserWsUrl();
  } catch (e) {
    console.warn(`[tab] could not create tab for ${tabName}: ${e.message}`);
  }
  const tabWsUrl = tabInfo?.wsUrl;
  const pageNum = tabInfo?.pageNum;

  if (action === 'init') {
    const url = targetUrl || 'https://www.google.com';
    emitText('Initializing browser session...');

    // Navigate directly via CDP so the tab shows the target URL immediately
    // (before opencode even starts — avoids showing about:blank)
    try {
      await cdpNavigate(tabName, url);
    } catch (e) {
      console.warn(`[init] cdpNavigate failed: ${e.message}`);
    }

    // Take an immediate screenshot from CDP — this is what connects the session
    let screenshot = null;
    try {
      screenshot = await cdpScreenshot(tabName);
    } catch (e) {
      console.warn(`[init] cdpScreenshot failed: ${e.message}`);
    }

    // Pre-warm chrome-devtools MCP by spawning it briefly so the first test run
    // doesn't hit a cold start
    try {
      const { spawn: sp } = await import('child_process');
      const warmup = sp('chrome-devtools-mcp', [
        `--wsEndpoint=${tabWsUrl}`, '--no-usage-statistics',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      // Send a minimal MCP init and immediately close
      warmup.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'warmup',version:'1'}}}) + '\n');
      setTimeout(() => { try { warmup.kill(); } catch {} }, 2000);
    } catch { /* ignore */ }

    if (screenshot) {
      emit({ screenshot: { data: screenshot } });
    }
    emitText(JSON.stringify({ status: screenshot ? 'connected' : 'no_screenshot' }));
    res.end();
    return;
  }

  if (action === 'run_test') {
    if (!tc || !targetUrl) {
      emitText(JSON.stringify({ error: 'testCase and targetUrl required' }));
      res.end();
      return;
    }

    const prompt = buildSystemPrompt(tc, targetUrl, pageNum, auth) +
      `\n\nNavigate to ${targetUrl} and execute test case ${tc.id}: ${tc.title}. Use the assert_pass or assert_fail tool when done.`;

    let lastScreenshot = null;

    const verdict = await runOpencode(prompt, workDir, assertResultFile, (ev) => {
      // Forward text narration
      if (ev.type === 'text' && ev.part?.text) {
        emitText(ev.part.text);
      }

      // Forward step labels as action events
      if (ev.type === 'tool_use' && ev.part?.tool) {
        emitText(`[${ev.part.tool}] ${ev.part.state?.title || ''}`);
      }

      // Extract screenshots from tool results
      const ss = extractScreenshot(ev);
      if (ss) {
        lastScreenshot = ss;
        emit({ screenshot: { data: ss } });
      }
    }, browserWs);

    // Resync tab tracking in case agent opened new_page (shouldn't happen but be safe)
    await resyncSessionTab(tabName);

    // Emit final screenshot from CDP
    if (!lastScreenshot) {
      try { lastScreenshot = await cdpScreenshot(tabName); } catch { /* ignore */ }
    }

    if (verdict) {
      // Emit as AgentCore-compatible tool use events
      const toolName = verdict.passed ? 'assert_pass' : 'assert_fail';
      emit({ contentBlockStart: { start: { toolUse: { name: toolName } } } });
      emit({ contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ reason: verdict.reason }) } } } });
    } else {
      emitText(JSON.stringify({ passed: false, reason: 'No verdict from agent' }));
    }

    if (lastScreenshot) {
      emit({ screenshot: { data: lastScreenshot } });
    }

    res.end();
    return;
  }

  emitText(JSON.stringify({ error: `Unknown action: ${action}` }));
  res.end();
});

// Kill all running opencode processes and reset tabs (called on reset)
app.post('/kill', async (req, res) => {
  const count = activeChildren.size;
  for (const child of activeChildren) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  activeChildren.clear();
  // Close all session tabs so next connect starts fresh
  await Promise.all(Object.keys(sessionTabs).map(name => closeTab(name)));
  res.json({ ok: true, killed: count });
});

app.listen(PORT, async () => {
  console.log(`Agent Runtime (OpenCode) on port ${PORT}`);
  console.log(`Bedrock region: ${BEDROCK_REGION}`);
  console.log(`Model: ${BEDROCK_MODEL_RAW}`);

  if (!CHROME_DEVTOOLS_URL) {
    startChromium();
    await waitForChromium();
  } else {
    console.log(`Chrome DevTools URL: ${CHROME_DEVTOOLS_URL}`);
  }
});
