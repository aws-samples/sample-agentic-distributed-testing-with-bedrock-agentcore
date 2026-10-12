import { Router } from 'express';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentCoreControlClient, GetAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore-control';
import { config, featureList, sessions, saveConfig } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { killSession } from '../services/sessions.js';

const router = Router();

// Valid AWS regions a user can pick from Settings. We keep this conservative —
// only regions known to host Bedrock and/or AgentCore. The UI also offers
// free-text input via the dropdown's __custom__ option for anything new.
const KNOWN_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-2',
  'eu-west-1', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
];
function isPlausibleRegion(r) {
  return typeof r === 'string' && /^[a-z]{2}-[a-z]+-\d+$/.test(r.trim());
}

router.get('/health', (req, res) => {
  const LOCAL_URL = process.env.LOCAL_RUNTIME_URL || 'http://localhost:4020';
  res.json({
    status: 'ok',
    targetUrl:        config.targetUrl,
    model:            config.bedrockModel,
    agentMode:        config.agentMode,
    bedrockRegion:    config.bedrockRegion,
    browserRegion:    config.browserRegion,
    features:          featureList,
    runtime:          config.agentMode === 'local' ? 'opencode-local' : 'agentcore-runtime',
    runtimeArn:       config.agentMode === 'agentcore' ? config.agentcoreRuntimeArn : null,
    localRuntimeUrl:  config.agentMode === 'local' ? LOCAL_URL : null,
    sessions: Object.fromEntries(Object.entries(sessions).map(([id, s]) => [id, { connected: s.connected, action: s.action }])),
  });
});

router.get('/config', (req, res) => {
  // Never echo the password — return whether one is set instead
  const authOut = {
    enabled: !!config.auth?.enabled,
    username: config.auth?.username || '',
    passwordSet: !!config.auth?.password,
  };
  res.json({
    targetUrl:        config.targetUrl,
    features:          featureList,
    model:            config.bedrockModel,
    agentMode:        config.agentMode,
    bedrockRegion:    config.bedrockRegion,
    browserRegion:    config.browserRegion,
    auth:             authOut,
  });
});

router.patch('/config/model', (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  config.bedrockModel = model.trim();
  saveConfig();
  broadcast({ type: 'config', targetUrl: config.targetUrl, features: featureList, model: config.bedrockModel });
  res.json({ model: config.bedrockModel });
});

// Update region settings — takes effect on the next AWS call without restart
// thanks to the per-region client cache in services/runner.js and
// services/sessions.js. bedrockRegion controls model inference;
// browserRegion controls AgentCore Runtime + AgentCore Browser.
router.patch('/config/regions', (req, res) => {
  const { bedrockRegion, browserRegion } = req.body || {};
  if (bedrockRegion !== undefined) {
    if (!isPlausibleRegion(bedrockRegion)) return res.status(400).json({ error: 'Invalid bedrockRegion' });
    config.bedrockRegion = bedrockRegion.trim();
  }
  if (browserRegion !== undefined) {
    if (!isPlausibleRegion(browserRegion)) return res.status(400).json({ error: 'Invalid browserRegion' });
    config.browserRegion = browserRegion.trim();
  }
  saveConfig();
  res.json({ bedrockRegion: config.bedrockRegion, browserRegion: config.browserRegion });
});

router.get('/config/regions/known', (req, res) => {
  res.json({ regions: KNOWN_REGIONS });
});

router.patch('/config/target-url', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });
  try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  config.targetUrl = url;
  saveConfig();
  broadcast({ type: 'config', targetUrl: config.targetUrl, features: featureList });
  res.json({ targetUrl: config.targetUrl });
});

// Update authentication for the target app. The agents inject these
// credentials into the system prompt so any test that needs to log in
// can succeed without the test case spelling out the username/password.
router.patch('/config/auth', (req, res) => {
  const { enabled, username, password } = req.body;
  const next = { ...config.auth };
  if (typeof enabled === 'boolean') next.enabled = enabled;
  if (typeof username === 'string') next.username = username;
  // Only overwrite the stored password when the client sends a new one
  // (empty string means "clear"; undefined means "leave unchanged")
  if (password !== undefined) next.password = String(password);
  config.auth = next;
  saveConfig();
  res.json({
    auth: {
      enabled: !!config.auth.enabled,
      username: config.auth.username || '',
      passwordSet: !!config.auth.password,
    },
  });
});

router.patch('/config/mode', async (req, res) => {
  const { mode } = req.body;
  if (!['local', 'agentcore'].includes(mode)) return res.status(400).json({ error: 'mode must be local or agentcore' });
  config.agentMode = mode;
  saveConfig();
  for (const sid of Object.keys(sessions)) {
    try { if (sessions[sid]?.ws) sessions[sid].ws.close(); } catch { /* ignore */ }
    delete sessions[sid];
    broadcast({ type: 'session_status', sessionId: sid, connected: false, feature: sid });
  }
  broadcast({ type: 'config', targetUrl: config.targetUrl, features: featureList, model: config.bedrockModel, agentMode: config.agentMode });
  res.json({ agentMode: config.agentMode });
});

// ─── Runtime detection ────────────────────────────────────────────────────────
// Does the platform see a usable agent runtime for the selected mode? Read-only calls.

async function checkLocalRuntime() {
  const url = process.env.LOCAL_RUNTIME_URL || 'http://localhost:4020';
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, detail: `${url} answered HTTP ${r.status}` };
    const d = await r.json().catch(() => ({}));
    return { ok: true, detail: `Reachable at ${url}${d.model ? ` (model ${d.model})` : ''}` };
  } catch {
    return { ok: false, detail: `Nothing listening at ${url} — run ./init-local-runtime.sh` };
  }
}

async function checkAgentcoreRuntime() {
  const arn = config.agentcoreRuntimeArn;
  if (!arn) return { ok: false, detail: 'No runtime ARN configured — run ./init-agentcore-runtime.sh and restart the backend' };
  // arn:aws:bedrock-agentcore:<region>:<acct>:runtime/<id> — use the ARN's own
  // region, which is authoritative for where the runtime lives.
  const [, , , region, , resource] = arn.split(':');
  const runtimeId = resource?.split('/')[1];
  if (!region || !runtimeId) return { ok: false, detail: `Malformed runtime ARN: ${arn}` };
  const note = region !== config.browserRegion ? ` (note: AgentCore region setting is ${config.browserRegion}, runtime is in ${region})` : '';
  try {
    const client = new BedrockAgentCoreControlClient({ region });
    const out = await client.send(new GetAgentRuntimeCommand({ agentRuntimeId: runtimeId }), { abortSignal: AbortSignal.timeout(5000) });
    const ok = out.status === 'READY';
    return { ok, detail: `${out.agentRuntimeName || runtimeId} is ${out.status} in ${region}${note}` };
  } catch (e) {
    const denied = /AccessDenied|not authorized/i.test(e.name + e.message);
    const missing = e.name === 'ResourceNotFoundException';
    return {
      ok: false,
      detail: missing ? `Runtime ${runtimeId} not found in ${region} — it may have been destroyed; re-run ./init-agentcore-runtime.sh`
        : denied ? `Not allowed to read the runtime (needs bedrock-agentcore:GetAgentRuntime): ${e.message}`
        : `Could not check runtime in ${region}: ${e.message}`,
    };
  }
}

// Only the selected runtime is checked: ?mode=local|agentcore (defaults to the
// backend's current agentMode).
router.get('/runtime-health', async (req, res) => {
  const mode = ['local', 'agentcore'].includes(req.query.mode) ? req.query.mode : config.agentMode;
  const result = mode === 'local' ? await checkLocalRuntime() : await checkAgentcoreRuntime();
  res.json({ mode, ...result });
});

router.post('/model/health-check', async (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== 'string') return res.status(400).json({ error: 'model required' });
  try {
    // Health-check uses the currently configured Bedrock region so the user
    // sees the same result they'd get from a real test invocation.
    const client = new BedrockRuntimeClient({ region: config.bedrockRegion });
    await client.send(new ConverseCommand({ modelId: model.trim(), messages: [{ role: 'user', content: [{ text: 'hi' }] }], inferenceConfig: { maxTokens: 1 } }));
    res.json({ ok: true, model: model.trim(), region: config.bedrockRegion });
  } catch (e) {
    res.json({ ok: false, model: model.trim(), region: config.bedrockRegion, error: e.message?.slice(0, 120) });
  }
});

export default router;
