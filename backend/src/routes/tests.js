import { Router } from 'express';
import { testRuns, stopFlags, sessions, config, testCasesByFeature, runLogs, activeRunPromises } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { runFeatureTests } from '../services/runner.js';
import { upsertRunRecord } from '../state/archive.js';

const router = Router();

router.post('/tests/run', (req, res) => {
  const { testCases } = req.body;
  if (!testCases?.length) return res.status(400).json({ error: 'testCases required' });

  const runId = `run-${Date.now()}`;
  testRuns[runId] = { runId, startedAt: new Date().toISOString(), results: {} };
  stopFlags[runId] = false;

  const byFeature = {};
  for (const tc of testCases) {
    if (!byFeature[tc.feature]) byFeature[tc.feature] = [];
    byFeature[tc.feature].push(tc);
  }

  // Shared by the live progress snapshots (below, fired after every test
  // case) and the final save — completedAt is the only thing that
  // distinguishes an in-progress record from a finished one.
  function buildRunRecord(completedAt) {
    const run = testRuns[runId] || {};
    const results = run.results || {};
    const features = {};
    let total = 0, pass = 0, fail = 0, pending = 0;

    for (const [feat, tcs] of Object.entries(byFeature)) {
      const cases = tcs.map(tc => {
        const r = results[tc.id] || {};
        const rawStatus = r.status || 'PENDING';
        // Once the run is actually finished nothing should still read as
        // RUNNING (e.g. a case whose feature errored out before reaching
        // it) — collapse those to PENDING. While still in progress, keep
        // RUNNING as-is so Analysis reflects real-time status instead of a
        // misleading PENDING.
        const status = (completedAt && rawStatus === 'RUNNING') ? 'PENDING' : rawStatus;
        total++;
        if (status === 'PASS') pass++;
        else if (status === 'FAIL') fail++;
        else pending++; // covers RUNNING and PENDING alike in the summary badge

        return {
          id: tc.id,
          title: tc.title || tc.id,
          status,
          reason: r.reason || '',
          snapshots: r.snapshots || [],  // [{key, ts, action, seq}] uploaded to S3
          logs: (runLogs[runId]?.[tc.id]) || [],
        };
      });
      features[feat] = { cases };
    }

    return {
      runId,
      startedAt: run.startedAt || new Date().toISOString(),
      completedAt,
      stopped: !!stopFlags[runId],
      targetUrl: config.targetUrl,
      summary: { total, pass, fail, pending },
      features,
    };
  }

  // Persists the run's current state (still in progress — completedAt
  // null) and tells any open Analysis page to refresh, so a run appears in
  // history the moment it starts and updates as each test case finishes,
  // instead of only after the whole run completes.
  function persistProgress() {
    upsertRunRecord(buildRunRecord(null));
    broadcast({ type: 'run_archive_updated', runId });
  }

  persistProgress(); // visible in Analysis immediately, all cases PENDING

  broadcast({ type: 'run_start', runId, features: Object.keys(byFeature) });

  const runPromise = Promise.all(Object.entries(byFeature).map(([feat, tcs]) => runFeatureTests(feat, tcs, runId, persistProgress)))
    .then(() => {
      const record = buildRunRecord(new Date().toISOString());
      upsertRunRecord(record);
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
