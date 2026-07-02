import { Router } from 'express';
import { moduleList, sessions, stopFlags, activeAborts, activeRunPromises, activeModules } from '../state/store.js';
import { config, abortAllActive, clearTestResults } from '../state/store.js';
import { ensureSession, killSession } from '../services/sessions.js';
import { broadcast } from '../services/websocket.js';

const router = Router();
const LOCAL_URL = process.env.LOCAL_RUNTIME_URL || 'http://localhost:4020';

router.post('/sessions/connect', async (req, res) => {
  const targets = req.body.modules || moduleList;
  const results = {};
  const BATCH = 2;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (mod) => {
        try { await ensureSession(mod); return [mod, { connected: true }]; }
        catch (e) { return [mod, { connected: false, error: e.message }]; }
      })
    );
    for (const [mod, r] of batchResults) results[mod] = r;
  }
  res.json(results);
});

router.post('/sessions/reset', async (req, res) => {
  // 1. Signal all in-flight runs to stop and abort outstanding fetches.
  for (const runId of Object.keys(stopFlags)) stopFlags[runId] = true;
  abortAllActive();

  // 2. Kill browser sessions so the runner's awaits unwind quickly.
  const killed = Object.keys(sessions);
  await Promise.all(killed.map(sid => killSession(sid)));
  if (config.agentMode === 'local') fetch(`${LOCAL_URL}/kill`, { method: 'POST' }).catch(() => {});

  // 3. Wait for any in-flight run promises to finish — this ensures the
  // post-run archive (saveRunRecord) completes before /reset returns,
  // so partial results aren't lost when the user clicks Reset mid-run.
  const pending = Array.from(activeRunPromises.values());
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }

  // 4. Clear cached results and active module set after everything is archived.
  clearTestResults();
  activeModules.clear();
  broadcast({ type: 'run_stopped' });
  res.json({ ok: true, killed });
});

router.get('/sessions/screenshot/:sessionId', (req, res) => {
  const sess = sessions[req.params.sessionId];
  res.json({ sessionId: req.params.sessionId, data: sess?.screenshot || null, action: sess?.action || '', connected: sess?.connected || false });
});

export default router;
