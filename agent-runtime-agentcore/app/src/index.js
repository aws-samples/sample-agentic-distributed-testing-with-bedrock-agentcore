/**
 * Agent Runtime (AgentCore) — OpenCode-based test execution server.
 *
 * Runs inside an Amazon Bedrock AgentCore Runtime container.
 * Uses AgentCore Browser for managed Chrome sessions (no local Chromium).
 * OpenCode is wired to chrome-devtools-mcp pointing at the AgentCore Browser CDP endpoint.
 *
 * POST / with JSON body { action, testCase?, targetUrl, sessionName? }
 * Responds with newline-delimited SSE events (same protocol as agent-runtime-local).
 */

import express from 'express';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, unlinkSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';
import { WebSocket as WS } from 'ws';
import { BedrockAgentCoreClient } from '@aws-sdk/client-bedrock-agentcore';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { Browser } from 'bedrock-agentcore/browser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSERT_SERVER = join(__dirname, 'assert-server.js');

const PORT           = process.env.PORT           || 8080;
const BEDROCK_REGION = process.env.BEDROCK_REGION || process.env.AWS_REGION || 'ap-southeast-1';
// BEDROCK_MODEL is shared with the backend/frontend as a bare model ID (e.g.
// "global.anthropic.claude-sonnet-5" — see .env.example), but opencode's
// config schema requires the "amazon-bedrock/<model-id>" provider prefix
// (same normalization as agent-runtime-local/src/index.js).
const BEDROCK_MODEL_RAW = process.env.BEDROCK_MODEL || 'us.anthropic.claude-sonnet-5';
const BEDROCK_MODEL = BEDROCK_MODEL_RAW.startsWith('amazon-bedrock/')
  ? BEDROCK_MODEL_RAW
  : `amazon-bedrock/${BEDROCK_MODEL_RAW}`;

const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── AgentCore Browser session pool ──────────────────────────────────────────
// One managed browser session per sessionName, lazily provisioned. A Browser
// instance tracks exactly one active session internally (startSession throws
// "Session already active" on a second call) — so each sessionName gets its
// own Browser instance, not a shared one, to support several modules running
// in parallel.
//
// startSession() only returns { sessionName, sessionId, createdAt } — no
// URL. The signed CDP WebSocket URL + auth headers come from a separate
// generateWebSocketUrl() call (SigV4-signed, since AgentCore's WS endpoint
// requires request signing, unlike a bare local Chrome CDP endpoint). Those
// signed headers embed x-amz-date and are only valid for a few minutes of
// clock-skew tolerance, so they're never cached — only the durable
// browser/sessionId pair is kept here; every WS connection below calls
// getCdpWebSocket() to sign a fresh one on demand.

// sessionName → { browser, sessionId }
const browserSessions = {};

// Diagnostic: logs the AWS identity this container is authenticating as, to
// cross-check a CloudWatch-logged "not authorized" error against the actual
// role/policy in effect.
async function logCallerIdentity(label) {
  try {
    const sts = new STSClient({ region: BEDROCK_REGION });
    const identity = await sts.send(new GetCallerIdentityCommand({}));
    console.log(`[identity] ${label}: Arn=${identity.Arn} Account=${identity.Account} UserId=${identity.UserId}`);
  } catch (e) {
    console.warn(`[identity] ${label} failed to resolve: ${e.message}`);
  }
}

async function getOrCreateBrowserSession(sessionName) {
  if (browserSessions[sessionName]) {
    return browserSessions[sessionName];
  }

  console.log(`[browser] provisioning AgentCore Browser session for "${sessionName}"`);
  await logCallerIdentity(`before startSession("${sessionName}")`);
  const browser = new Browser({ region: BEDROCK_REGION });
  const session = await browser.startSession({ sessionName });

  browserSessions[sessionName] = { browser, sessionId: session.sessionId };
  console.log(`[browser] session ready: ${session.sessionId}`);
  return browserSessions[sessionName];
}

// Signs a fresh CDP WebSocket URL + headers for an already-started session —
// call this immediately before every actual WS connection, never cache the
// result (see comment above getOrCreateBrowserSession).
async function getCdpWebSocket(sessionName) {
  const sess = browserSessions[sessionName];
  if (!sess) throw new Error(`No browser session for "${sessionName}"`);
  await logCallerIdentity(`before generateWebSocketUrl("${sessionName}")`);
  const { url, headers } = await sess.browser.generateWebSocketUrl();
  console.log(`[browser] signed WS url for "${sessionName}": ${url} authHeaderPrefix=${headers?.authorization?.slice(0, 60)}`);
  return { url, headers };
}

async function stopBrowserSession(sessionName) {
  const sess = browserSessions[sessionName];
  if (!sess) return;
  try {
    await sess.browser.stopSession();
    console.log(`[browser] stopped session "${sessionName}" (${sess.sessionId})`);
  } catch (e) {
    console.warn(`[browser] stop failed for "${sessionName}": ${e.message}`);
  }
  delete browserSessions[sessionName];
}

// Take a screenshot via the browser session's own signed CDP WebSocket. The
// Browser SDK class has no screenshot() method, so this sends
// Page.captureScreenshot directly — but AgentCore Browser's CDP endpoint is
// a real multi-target browser (like local Chrome with several tabs/workers
// open), so target-scoped methods need Target.getTargets → pick the page
// target → Target.attachToTarget({flatten: true}) first, tagging every
// subsequent command with the resulting CDP session ID.
async function agentCoreScreenshot(sessionName) {
  const { url: cdpWsUrl, headers: cdpWsHeaders } = await getCdpWebSocket(sessionName);
  return new Promise((resolve, reject) => {
    const ws = new WS(cdpWsUrl, { headers: cdpWsHeaders });
    let nextId = 1;
    function send(method, params = {}, cdpSessionId) {
      const id = nextId++;
      const msg = { id, method, params };
      if (cdpSessionId) msg.sessionId = cdpSessionId;
      ws.send(JSON.stringify(msg));
      return id;
    }
    const timeout = setTimeout(() => { ws.close(); reject(new Error('AgentCore Browser screenshot timed out')); }, 8000);
    const pending = {}; // id → what we're waiting for
    ws.on('open', () => {
      pending[send('Target.getTargets')] = 'getTargets';
    });
    // ws's generic 'error' on a rejected handshake only says "Unexpected
    // server response: <code>" — capture the actual response body (AWS's
    // real error code/message, e.g. AccessDenied vs. something else) so
    // failures are diagnosable instead of a bare HTTP status.
    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timeout);
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        reject(new Error(`AgentCore Browser screenshot failed: WS handshake rejected (${res.statusCode} ${res.statusMessage}): ${body.slice(0, 500)}`));
      });
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const waitingFor = pending[msg.id];
      if (waitingFor === 'getTargets') {
        delete pending[msg.id];
        const pageTarget = msg.result?.targetInfos?.find(t => t.type === 'page');
        if (!pageTarget) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error('AgentCore Browser screenshot failed: no page target found'));
          return;
        }
        pending[send('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })] = 'attach';
      } else if (waitingFor === 'attach') {
        delete pending[msg.id];
        const cdpSessionId = msg.result?.sessionId;
        if (!cdpSessionId) {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`AgentCore Browser screenshot failed: attach returned no sessionId (${JSON.stringify(msg.error || msg)})`));
          return;
        }
        send('Page.enable', {}, cdpSessionId);
        setTimeout(() => {
          pending[send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, cdpSessionId)] = 'screenshot';
        }, 500);
      } else if (waitingFor === 'screenshot') {
        delete pending[msg.id];
        clearTimeout(timeout);
        ws.close();
        if (msg.result?.data) resolve(msg.result.data);
        else reject(new Error(`AgentCore Browser screenshot failed: ${JSON.stringify(msg.error || msg)}`));
      }
    });
    ws.on('error', (e) => { clearTimeout(timeout); reject(new Error(`AgentCore Browser screenshot failed: ${e.message}`)); });
  });
}

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
    credsExpiry = new Date(creds.Expiration).getTime() - 5 * 60 * 1000;
    // Diagnostic: never log secret values, but lengths/presence catch a
    // truncated IMDS response or wrong-shaped fields without exposing them.
    console.log(`[imds] role=${role} accessKeyLen=${cachedCreds.AWS_ACCESS_KEY_ID?.length ?? 'missing'} secretKeyLen=${cachedCreds.AWS_SECRET_ACCESS_KEY?.length ?? 'missing'} sessionTokenLen=${cachedCreds.AWS_SESSION_TOKEN?.length ?? 'missing'} expiration=${creds.Expiration} code=${creds.Code}`);
    return cachedCreds;
  } catch (e) {
    console.log(`[imds] getAwsCredentials failed: ${e.message}`);
    return null;
  }
}

// ─── Config & prompt builders ─────────────────────────────────────────────────

function buildSystemPrompt(tc, targetUrl, auth) {
  const steps = (tc.steps || []).map((s, i) => `  ${i + 1}. ${s}`).join('\n');
  const expectedLines = (Array.isArray(tc.expectedResult) ? tc.expectedResult : [tc.expectedResult])
    .filter(Boolean).map((e, i) => `  ${i + 1}. ${e}`).join('\n');
  const authSection = (auth && auth.username) ? `

AUTHENTICATION CREDENTIALS:
This application requires authentication. Use these credentials whenever a login form, sign-in prompt, or authentication challenge appears — even if the test case does not explicitly mention them:
- Username: ${auth.username}
- Password: ${auth.password}
If you are not already logged in when you reach the page needed for this test, log in first using the credentials above, then proceed with the test steps.` : '';
  return `You are an expert QA automation engineer testing a web application.

TARGET URL: ${targetUrl}
IMPORTANT: Always start by navigating to ${targetUrl}. Ignore any URLs mentioned in the test steps — use ONLY ${targetUrl} as the starting point.${authSection}

RULES:
1. Navigate to ${targetUrl} first, then follow the test steps
2. Use browser tools to interact with the page (click, type, scroll, read)
3. Do NOT open new tabs or windows
4. EVIDENCE SCREENSHOTS — these are required so reviewers can audit your verdict:
   a. Take a screenshot AFTER landing on the target URL (initial state)
   b. Take a screenshot AFTER each significant action (login submitted, form submitted, navigation completed, important state change)
   c. ALWAYS take a final screenshot RIGHT BEFORE calling assert_pass or assert_fail — this is the evidence that supports your verdict
   d. WAIT FOR THE PAGE TO FULLY RENDER before each screenshot — the page text/UI must be visible, no loading spinners, no blank/white intermediate state. If you see a blank or partially-loaded page, wait briefly and take another screenshot. NEVER submit a blank screenshot as evidence.
5. In your assert_pass / assert_fail reason, REFERENCE what is visible in the final screenshot (e.g. "Dashboard shows welcome message for user X" or "Login form shows error: invalid credentials")
6. Call assert_pass or assert_fail EXACTLY ONCE when done, then stop
7. If a step says "navigate to <url>", treat it as navigating to ${targetUrl}

Test Case:
- ID: ${tc.id || ''}
- Module: ${tc.module || ''}
- Title: ${tc.title || ''}
- Steps:
${steps}
- Expected Result:
${expectedLines}`;
}

function buildOpencodeConfig(assertResultFile, cdpWsUrl, cdpWsHeaders) {
  // AgentCore's WS endpoint requires SigV4-signed headers on the upgrade
  // request — chrome-devtools-mcp's --wsHeaders passes them through.
  const chromeMcpArgs = cdpWsUrl.startsWith('ws')
    ? [`--wsEndpoint=${cdpWsUrl}`, ...(cdpWsHeaders ? [`--wsHeaders=${JSON.stringify(cdpWsHeaders)}`] : [])]
    : [`--browser-url=${cdpWsUrl}`];

  return {
    $schema: 'https://opencode.ai/config.json',
    model: BEDROCK_MODEL,
    provider: {
      'amazon-bedrock': {
        options: { region: BEDROCK_REGION },
      },
    },
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

const activeChildren = new Set();

async function runOpencode(prompt, workDir, assertResultFile, onEvent, cdpWsUrl, cdpWsHeaders) {
  const configPath = join(workDir, 'opencode.json');
  writeFileSync(configPath, JSON.stringify(buildOpencodeConfig(assertResultFile, cdpWsUrl, cdpWsHeaders), null, 2));
  const awsCreds = await getAwsCredentials();
  // Diagnostic: if getAwsCredentials() (classic EC2 IMDS) returns null, the
  // opencode child gets no explicit AWS creds beyond whatever's already in
  // process.env (spread in below) — log which container-credential env vars
  // are actually present to tell the two cases apart.
  const containerCredKeys = Object.keys(process.env).filter(k => k.startsWith('AWS_') || k.includes('CONTAINER_CREDENTIALS'));
  console.log(`[opencode] getAwsCredentials() returned ${awsCreds ? 'creds' : 'null'}; AWS-related env vars present: ${containerCredKeys.join(', ') || '(none)'}`);

  return new Promise((resolve) => {
    const child = spawn(
      'opencode',
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
          if (ev.type === 'error') {
            console.log(`[opencode] error event: ${JSON.stringify(ev).slice(0, 1000)}`);
          }
          onEvent(ev);
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
      const text = d.toString();
      console.log(`[opencode stderr] ${text.slice(0, 500)}`);
      onEvent({ type: 'log', text });
    });

    child.on('close', (code, signal) => {
      console.log(`[opencode] child closed: code=${code} signal=${signal} resolved=${resolved} bufTail=${buf.slice(-200)}`);
      activeChildren.delete(child);
      if (resolved) return;
      if (buf.trim()) {
        try { onEvent(JSON.parse(buf)); } catch { /* ignore */ }
      }
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
      console.log(`[opencode] child spawn error: ${e.message}`);
      activeChildren.delete(child);
      onEvent({ type: 'error', text: e.message });
      tryResolve(null);
    });
  });
}

function extractScreenshot(ev) {
  if (ev.type !== 'tool_use') return null;
  const state = ev.part?.state;
  if (!state) return null;

  if (Array.isArray(state.attachments)) {
    for (const att of state.attachments) {
      if (att?.mime?.startsWith('image/') && att?.url) {
        const match = att.url.match(/^data:[^;]+;base64,(.+)$/);
        if (match) return match[1];
      }
    }
  }

  if (typeof state.output === 'string') {
    if (state.output.startsWith('/9j/') || state.output.startsWith('iVBOR')) {
      return state.output;
    }
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
  res.json({ status: 'ok', runtime: 'opencode-agentcore', region: BEDROCK_REGION, model: BEDROCK_MODEL });
});

// AgentCore Runtime's actual HTTP contract (see the bedrock-agentcore SDK's
// BedrockAgentCoreApp) — the front door health-checks GET /ping and routes
// invocations to POST /invocations, not a bare POST /. Without these two
// routes every InvokeAgentRuntime call 404s before ever reaching our handler
// below, regardless of a valid ARN/region.
app.get('/ping', (req, res) => {
  res.json({ status: 'Healthy', time_of_last_update: Math.floor(Date.now() / 1000) });
});

app.post('/invocations', async (req, res) => {
  return handleInvocation(req, res);
});

app.post('/', async (req, res) => {
  return handleInvocation(req, res);
});

async function handleInvocation(req, res) {
  const { action = 'run_test', testCase: tc, targetUrl, sessionName = 'default', auth } = req.body;

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

  let sess;
  try {
    sess = await getOrCreateBrowserSession(sessionName);
  } catch (e) {
    emitText(JSON.stringify({ error: `Browser session failed: ${e.message}` }));
    res.end();
    return;
  }

  if (action === 'init') {
    // Navigate to target URL and take an initial screenshot
    const url = targetUrl || 'https://www.google.com';
    emitText('Initializing browser session...');
    try {
      const screenshot = await agentCoreScreenshot(sessionName);
      if (screenshot) emit({ screenshot: { data: screenshot } });
      // Report the AgentCore Browser sessionId back to the backend so it can
      // poll this exact session's screenshots (not an arbitrary READY
      // session — see backend/src/services/sessions.js's grabLatestScreenshot,
      // which previously used listSessions()[0], liable to show one module's
      // live view from a completely different module's browser session).
      emitText(JSON.stringify({ status: screenshot ? 'connected' : 'no_screenshot', browserSessionId: sess.sessionId }));
    } catch (e) {
      console.warn(`[init] screenshot failed: ${e.message}`);
      emitText(JSON.stringify({ status: 'error', error: e.message }));
    }
    res.end();
    return;
  }

  if (action === 'run_test') {
    if (!tc || !targetUrl) {
      emitText(JSON.stringify({ error: 'testCase and targetUrl required' }));
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
    const prompt = buildSystemPrompt(tc, targetUrl, auth) +
      `\n\nNavigate to ${targetUrl} and execute test case ${tc.id}: ${tc.title}. Use the assert_pass or assert_fail tool when done.`;

    let lastScreenshot = null;

    const { url: cdpWsUrl, headers: cdpWsHeaders } = await getCdpWebSocket(sessionName);
    const verdict = await runOpencode(prompt, workDir, assertResultFile, (ev) => {
      if (ev.type === 'text' && ev.part?.text) {
        emitText(ev.part.text);
      }
      if (ev.type === 'tool_use' && ev.part?.tool) {
        emitText(`[${ev.part.tool}] ${ev.part.state?.title || ''}`);
      }
      const ss = extractScreenshot(ev);
      if (ss) {
        lastScreenshot = ss;
        emit({ screenshot: { data: ss } });
      }
    }, cdpWsUrl, cdpWsHeaders);

    // Emit final screenshot
    if (!lastScreenshot) {
      try { lastScreenshot = await agentCoreScreenshot(sessionName); } catch { /* ignore */ }
    }

    if (verdict) {
      const toolName = verdict.passed ? 'assert_pass' : 'assert_fail';
      emit({ contentBlockStart: { start: { toolUse: { name: toolName } } } });
      emit({ contentBlockDelta: { delta: { toolUse: { input: JSON.stringify({ reason: verdict.reason }) } } } });
    } else {
      emitText(JSON.stringify({ passed: false, reason: 'No verdict from agent' }));
    }

    if (lastScreenshot) emit({ screenshot: { data: lastScreenshot } });

    res.end();
    return;
  }

  emitText(JSON.stringify({ error: `Unknown action: ${action}` }));
  res.end();
}

// GET /screenshot?session=<name> — poll latest screenshot (backend screen poller)
app.get('/screenshot', async (req, res) => {
  const sessionName = req.query.session || 'default';
  try {
    const data = await agentCoreScreenshot(sessionName);
    res.json({ data });
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// DELETE /session/:name — release AgentCore Browser session
app.delete('/session/:name', async (req, res) => {
  await stopBrowserSession(req.params.name);
  res.json({ ok: true });
});

// Kill all running opencode processes and release all browser sessions
app.post('/kill', async (req, res) => {
  const count = activeChildren.size;
  for (const child of activeChildren) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  activeChildren.clear();
  await Promise.all(Object.keys(browserSessions).map(name => stopBrowserSession(name)));
  res.json({ ok: true, killed: count });
});

app.listen(PORT, () => {
  console.log(`Agent Runtime (OpenCode + AgentCore Browser) on port ${PORT}`);
  console.log(`Bedrock region: ${BEDROCK_REGION}`);
  console.log(`Model: ${BEDROCK_MODEL}`);
});
