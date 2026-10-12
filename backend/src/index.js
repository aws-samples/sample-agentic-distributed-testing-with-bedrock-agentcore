import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import http from 'http';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initWebSocket } from './services/websocket.js';
import { config, featureList, testCasesByFeature, featureDescriptions, initEc2Region } from './state/store.js';
import { assignTcIds, bddFields } from './services/tcIds.js';
import { replaceAllFeaturesAndCases } from './state/db.js';
import { requireAuth, authEnabled } from './middleware/auth.js';
import configRoutes   from './routes/config.js';
import featureRoutes   from './routes/features.js';
import sessionRoutes  from './routes/sessions.js';
import testRoutes     from './routes/tests.js';
import yamlRoutes     from './routes/yaml.js';
import analysisRoutes from './routes/analysis.js';
import generateRoutes from './routes/generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSeed() {
  // Only seed when there is truly no data yet — respects user deletions/imports
  if (featureList.length > 0) return;
  const seedPath = path.join(__dirname, 'state', 'seed.yaml');
  try {
    const raw = fs.readFileSync(seedPath, 'utf8');
    const doc = yaml.load(raw);
    if (!doc?.features && Array.isArray(doc?.modules)) doc.features = doc.modules;
    if (!doc?.features) return;
    assignTcIds(doc.features);
    // Seed the targetUrl too, but only if nothing else has already set it
    // (env var TARGET_URL or persisted config.json both take precedence).
    if (doc.targetUrl && !process.env.TARGET_URL) {
      // store.js may have loaded a persisted targetUrl already; only override
      // when we're still on the hard-coded default
      if (config.targetUrl === 'http://localhost:8020' || !config.targetUrl) {
        config.targetUrl = doc.targetUrl;
      }
    }
    for (const featDef of doc.features) {
      const name = (featDef.name || '').trim();
      if (!name) continue;
      if (!featureList.includes(name)) featureList.push(name);
      featureDescriptions[name] = String(featDef.description || '').trim();
      if (Array.isArray(featDef.testCases)) {
        if (!testCasesByFeature[name]) testCasesByFeature[name] = [];
        for (const tc of featDef.testCases) {
          if (!tc.title) continue;
          testCasesByFeature[name].push({
            id: tc.id, feature: name, title: tc.title, status: 'PENDING',
            ...bddFields(tc),
          });
        }
      }
    }
    replaceAllFeaturesAndCases(featureList, testCasesByFeature, featureDescriptions);
    console.log('Seed loaded:', featureList.map(m => `${m}(${(testCasesByFeature[m]||[]).length})`).join(', '));
  } catch (e) {
    console.warn('Seed load skipped:', e.message);
  }
}

loadSeed();
// Resolve EC2 region in the background so AgentCore defaults match the host.
// We don't block server startup on this — it's a best-effort default.
initEc2Region().catch(() => {});

const app  = express();
const PORT = process.env.PORT || 4010;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api/import', express.text({ type: 'text/yaml', limit: '10mb' }));

// Cognito auth gate — no-op when COGNITO_USER_POOL_ID/COGNITO_CLIENT_ID are
// unset (local dev). /api/health is excluded so health probes without a
// browser session or token still get a 200. See middleware/auth.js.
if (authEnabled) console.log('[auth] Cognito verification enabled for /api/*');
app.use('/api', (req, res, next) => (req.path === '/health' ? next() : requireAuth(req, res, next)));

app.use('/api', configRoutes);
app.use('/api', featureRoutes);
app.use('/api', sessionRoutes);
app.use('/api', testRoutes);
app.use('/api', yamlRoutes);
app.use('/api', analysisRoutes);
app.use('/api', generateRoutes);

const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`Agentic Test Runner backend  port=${PORT}`);
  console.log(`Mode: ${config.agentMode}  Model: ${config.bedrockModel}`);
  console.log(`Target: ${config.targetUrl}`);
  console.log(`Features: ${featureList.join(', ')}`);
});
