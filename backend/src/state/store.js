/**
 * Shared mutable state — single source of truth for all runtime data.
 * Exported as a plain object so every module mutates the same reference.
 */

import fs   from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { loadModulesAndCases } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = path.join(__dirname, 'testResults.json');
const CONFIG_FILE  = path.join(__dirname, 'config.json');

function loadPersistedConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw) || {};
  } catch { return {}; }
}
const _persisted = loadPersistedConfig();

// Best-effort: detect the EC2 host region via IMDSv2 so AgentCore defaults to
// the same region. Falls back to BROWSER_REGION env / ap-southeast-1.
async function detectEc2Region() {
  const token = await new Promise((resolve) => {
    const req = http.request({
      hostname: '169.254.169.254', path: '/latest/api/token', method: 'PUT',
      headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' }, timeout: 1500,
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d.trim()));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
  if (!token) return null;
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '169.254.169.254', path: '/latest/dynamic/instance-identity/document',
      headers: { 'X-aws-ec2-metadata-token': token }, timeout: 1500,
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d).region || null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

export const config = {
  targetUrl:    _persisted.targetUrl  ?? (process.env.TARGET_URL    || 'http://localhost:8020'),
  bedrockModel: _persisted.bedrockModel ?? (process.env.BEDROCK_MODEL || 'global.anthropic.claude-sonnet-5'),
  agentMode: _persisted.agentMode ?? (process.env.AGENT_MODE || 'agentcore'),   // 'local' | 'agentcore'
  // Bedrock model inference region. Defaults to BEDROCK_REGION env or us-east-1.
  bedrockRegion: _persisted.bedrockRegion ?? (process.env.BEDROCK_REGION || 'us-east-1'),
  // AgentCore Runtime / Browser region. Defaults to BROWSER_REGION env or the
  // EC2 host's own region (resolved lazily via initEc2Region below).
  browserRegion: _persisted.browserRegion ?? (process.env.BROWSER_REGION || 'ap-southeast-1'),
  // AgentCore Runtime ARN — pinned by env in docker-compose. Region implied by the ARN.
  agentcoreRuntimeArn: _persisted.agentcoreRuntimeArn ?? process.env.AGENTCORE_RUNTIME_ARN ?? null,
  auth:         _persisted.auth ?? { enabled: false, username: '', password: '' },
};

// If no persisted browser region and no env override, try to match the EC2 host
export async function initEc2Region() {
  if (_persisted.browserRegion || process.env.BROWSER_REGION) return;
  const detected = await detectEc2Region();
  if (detected) {
    config.browserRegion = detected;
    console.log(`[config] detected EC2 region → ${detected}`);
  }
}

let _configSaveTimer = null;
export function saveConfig() {
  clearTimeout(_configSaveTimer);
  _configSaveTimer = setTimeout(() => {
    try {
      const persist = {
        targetUrl:           config.targetUrl,
        auth:                config.auth,
        bedrockModel:        config.bedrockModel,
        bedrockRegion:       config.bedrockRegion,
        browserRegion:       config.browserRegion,
        agentMode:           config.agentMode,
        agentcoreRuntimeArn: config.agentcoreRuntimeArn,
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(persist, null, 2));
    } catch { /* ignore */ }
  }, 300);
}

// Hydrated from SQLite (backend/src/state/data.db) on boot. index.js's
// loadSeed() only populates the DB the very first time it's empty; after
// that, edits made via the Editor persist here and survive restarts.
const { modules: _seedModules, casesByModule: _seedCases } = loadModulesAndCases();
export const moduleList = _seedModules;

export const testCasesByModule = _seedCases;
export const testRuns          = {};
export const stopFlags         = {};
// Per-run, per-TC log accumulator: runLogs[runId][tcId] = [{ts,msg,kind}]
export const runLogs           = {};
export const sessions          = {};           // moduleName → session object
export const activeAborts      = new Set();    // AbortControllers for in-flight fetches
// Modules currently running a test — mirrors the frontend's activeModules set so
// the WebSocket reconnect snapshot can restore the Stop-button state.
export const activeModules     = new Set();   // moduleName
// Promise of each in-flight run; awaited by /sessions/reset to make sure all
// pending results are archived before the reset returns.
export const activeRunPromises = new Map();   // runId → Promise

// ─── Persistent test results ──────────────────────────────────────────────────
// Flat map: { [tcId]: { status: 'PASS'|'FAIL'|'PENDING', reason: string } }
// Loaded from disk on startup, written on every change, replayed to new WS clients.

function loadResultsFromDisk() {
  try {
    const raw = fs.readFileSync(RESULTS_FILE, 'utf8');
    return JSON.parse(raw) || {};
  } catch { return {}; }
}

export const testResultsCache = loadResultsFromDisk();

let _saveTimer = null;
export function saveTestResult(tcId, status, reason = '') {
  testResultsCache[tcId] = { status, reason };
  // Debounce disk writes — flush at most every 500ms
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try { fs.writeFileSync(RESULTS_FILE, JSON.stringify(testResultsCache)); } catch { /* ignore */ }
  }, 500);
}

export function clearTestResults() {
  for (const k of Object.keys(testResultsCache)) delete testResultsCache[k];
  try { fs.writeFileSync(RESULTS_FILE, '{}'); } catch { /* ignore */ }
}

export function abortAllActive() {
  for (const ctrl of activeAborts) {
    try { ctrl.abort(); } catch { /* ignore */ }
  }
  activeAborts.clear();
}
