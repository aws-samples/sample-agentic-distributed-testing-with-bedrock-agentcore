import { Router } from 'express';
import { testRuns, stopFlags, sessions, config, testCasesByModule, runLogs, activeRunPromises } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { runModuleTests } from '../services/runner.js';
import { saveRunRecord } from '../state/archive.js';

const router = Router();

router.post('/tests/run', (req, res) => {
  const { testCases } = req.body;
  if (!testCases?.length) return res.status(400).json({ error: 'testCases required' });

  const runId = `run-${Date.now()}`;
  testRuns[runId] = { runId, startedAt: new Date().toISOString(), results: {} };
  stopFlags[runId] = false;

  const byModule = {};
  for (const tc of testCases) {
    if (!byModule[tc.module]) byModule[tc.module] = [];
    byModule[tc.module].push(tc);
  }

  broadcast({ type: 'run_start', runId, modules: Object.keys(byModule) });

  const runPromise = Promise.all(Object.entries(byModule).map(([mod, tcs]) => runModuleTests(mod, tcs, runId)))
    .then(() => {
      const completedAt = new Date().toISOString();
      const run = testRuns[runId] || {};
      const results = run.results || {};

      // Build per-module case list from byModule test case definitions
      const modules = {};
      let total = 0, pass = 0, fail = 0, pending = 0;

      for (const [mod, tcs] of Object.entries(byModule)) {
        const cases = tcs.map(tc => {
          const r = results[tc.id] || {};
          const status = r.status === 'RUNNING' ? 'PENDING' : (r.status || 'PENDING');
          total++;
          if (status === 'PASS') pass++;
          else if (status === 'FAIL') fail++;
          else pending++;

          return {
            id: tc.id,
            title: tc.title || tc.id,
            status,
            reason: r.reason || '',
            snapshots: r.snapshots || [],  // [{key, ts, action, seq}] uploaded to S3
            logs: (runLogs[runId]?.[tc.id]) || [],
          };
        });
        modules[mod] = { cases };
      }

      const record = {
        runId,
        startedAt: run.startedAt || new Date().toISOString(),
        completedAt,
        stopped: !!stopFlags[runId],
        targetUrl: config.targetUrl,
        summary: { total, pass, fail, pending },
        modules,
      };

      saveRunRecord(record);
      delete runLogs[runId]; // free memory after archiving
      broadcast({ type: 'run_complete', runId, stopped: record.stopped });
      broadcast({ type: 'run_archive_updated', runId });
    })
    .catch(e => console.error('Run error:', e))
    .finally(() => {
      // De-register so /sessions/reset doesn't await a finished promise.
      activeRunPromises.delete(runId);
    });

  activeRunPromises.set(runId, runPromise);

  res.json({ runId });
});

router.get('/tests/run/:runId', (req, res) => {
  const run = testRuns[req.params.runId];
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});

router.post('/tests/stop', (req, res) => {
  for (const runId of Object.keys(stopFlags)) stopFlags[runId] = true;
  broadcast({ type: 'run_stopped' });
  res.json({ ok: true });
});

router.post('/tests/run/:runId/stop', (req, res) => {
  const { runId } = req.params;
  // runId comes straight from the URL — only allow it into the stopFlags
  // bracket assignment once we've confirmed it's a run we actually created
  // (mirrors the GET route's 404 check above). Without this, an arbitrary
  // path segment reaches `stopFlags[runId] = true`, including special keys
  // like "__proto__"/"constructor".
  if (!Object.prototype.hasOwnProperty.call(testRuns, runId)) {
    return res.status(404).json({ error: 'Run not found' });
  }
  stopFlags[runId] = true;
  broadcast({ type: 'run_stopped', runId });
  res.json({ ok: true });
});

export default router;
