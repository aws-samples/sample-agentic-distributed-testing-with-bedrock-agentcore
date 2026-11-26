import { Router } from 'express';
import { testRuns, stopFlags, sessions, config, testCasesByFeature, runLogs, activeRunPromises, featureList, activeFeatures } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { runFeatureTests, enqueueRedo, cancelRedo } from '../services/runner.js';
import { upsertRunRecord, runArchive } from '../state/archive.js';
import { pausedFeatures, pauseState, planRedo, addRetry, removeRetry, caseProgress, lastFrames } from '../services/runControl.js';

const router = Router();

// Starts a run of `testCases`, one parallel session per feature, and returns its runId.
// `hints` ({ [tcId]: { hint, retryOf } }) is set only for a redo-with-hint run. `queued` is a redo of
// a paused feature: its cases go onto the feature's live loop instead of starting a second one.
function startRun(testCases, hints = {}, queued = false) {
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

        const h = hints[tc.id];
        const retries = run.retries?.[tc.id];
        return {
          id: tc.id,
          title: tc.title || tc.id,
          status,
          reason: r.reason || '',
          snapshots: r.snapshots || [],  // [{key, ts, action, seq}] uploaded to S3
          logs: (runLogs[runId]?.[tc.id]) || [],
          // Human input: this case was redone with `hint`; retryOf is the run it replaces.
          ...(h ? { hint: h.hint, retryOf: h.retryOf } : {}),
          ...(run.cancelled?.[tc.id] ? { cancelled: true } : {}),   // a redo cancelled before it started
          // Later runs that redid this case with a human hint: [{ runId, hint, ts }].
          ...(retries?.length ? { retries } : {}),
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

  const runOne = queued ? enqueueRedo : runFeatureTests;
  const runPromise = Promise.all(Object.entries(byFeature).map(([feat, tcs]) => runOne(feat, tcs, runId, persistProgress, hints)))
    .then(() => {
      const record = buildRunRecord(new Date().toISOString());
      upsertRunRecord(record);
      delete runLogs[runId]; // free memory after archiving
      // A queued redo finishes inside a feature that is still paused and running: it clears no feature.
      broadcast({ type: 'run_complete', runId, stopped: record.stopped, features: queued ? [] : Object.keys(byFeature) });
      broadcast({ type: 'run_archive_updated', runId });
    })
    .catch(e => console.error('Run error:', e))
    .finally(() => {
      // De-register so /sessions/reset doesn't await a finished promise.
      activeRunPromises.delete(runId);
    });

  activeRunPromises.set(runId, runPromise);

  return runId;
}

router.post('/tests/run', (req, res) => {
  const { testCases } = req.body;
  if (!testCases?.length) return res.status(400).json({ error: 'testCases required' });
  res.json({ runId: startRun(testCases) });
});

// Redo failed (or suspicious) cases of one feature with a human hint added to the agent's
// prompt. Runs as a new run so the earlier result stays in history; the new case links back
// (retryOf) and the earlier case gets a retries entry, so Analysis shows both. While the feature
// is paused, finished cases are accepted too and run in its session before it resumes.
router.post('/tests/redo', (req, res) => {
  const { feature, testCaseIds, hint } = req.body || {};
  const plan = planRedo({ feature, testCaseIds, hint, featureList, casesByFeature: testCasesByFeature, archive: runArchive, activeFeatures });
  if (plan.error) return res.status(plan.status).json({ error: plan.error });
  const runId = startRun(plan.testCases, plan.hints, plan.queued);
  const ts = new Date().toISOString();
  for (const tc of plan.testCases) {
    const { hint: text, retryOf } = plan.hints[tc.id];
    if (!retryOf) continue;
    const entry = { runId, hint: text, ts };
    const live = testRuns[retryOf];
    if (live) { live.retries = live.retries || {}; live.retries[tc.id] = [...(live.retries[tc.id] || []), entry]; }
    const archived = runArchive.find(r => r.runId === retryOf);
    if (archived && addRetry(archived, tc.id, entry)) {
      upsertRunRecord(archived);
      broadcast({ type: 'run_archive_updated', runId: retryOf });
    }
  }
  res.json({ runId });
});

// Pause / resume one feature's run loop. Takes effect at the next test case boundary.
router.post('/tests/pause', (req, res) => {
  const { feature } = req.body || {};
  if (typeof feature !== 'string' || !activeFeatures.has(feature)) return res.status(409).json({ error: 'Feature is not running' });
  // A pause holds before the next case; with none left it would change nothing, so say so.
  const p = caseProgress.get(feature);
  if (p && p.remaining === 0) return res.status(409).json({ error: `${p.tcId} is the last test case of ${feature}: nothing is left to pause before.` });
  pausedFeatures.add(feature);
  broadcast({ type: 'feature_pause_requested', ...pauseState(feature) });
  res.json(pauseState(feature));
});

// Cancel a queued redo before it starts. runId + testCaseId identify the queued job.
router.post('/tests/redo/cancel', (req, res) => {
  const { feature, runId, testCaseId } = req.body || {};
  if (typeof feature !== 'string' || typeof runId !== 'string' || typeof testCaseId !== 'string') return res.status(400).json({ error: 'feature, runId and testCaseId required' });
  const job = cancelRedo(feature, runId, testCaseId);
  if (!job) return res.status(409).json({ error: `${testCaseId} is not queued any more (it may have started).` });
  // The earlier result no longer has a retry coming: drop the link added when the redo was queued.
  const prior = job.hints?.[testCaseId]?.retryOf;
  if (testRuns[prior]?.retries?.[testCaseId]) testRuns[prior].retries[testCaseId] = testRuns[prior].retries[testCaseId].filter(r => r.runId !== runId);
  const archived = runArchive.find(r => r.runId === prior);
  if (archived && removeRetry(archived, testCaseId, runId)) { upsertRunRecord(archived); broadcast({ type: 'run_archive_updated', runId: prior }); }
  res.json({ ok: true });
});

// Last browser frame the agent produced for a test case (base64), for a finished case's row.
router.get('/tests/frame/:tcId', (req, res) => {
  const data = lastFrames.get(req.params.tcId);
  if (!data) return res.status(404).json({ error: 'No frame for this test case' });
  res.json({ data });
});

router.post('/tests/resume', (req, res) => {
  const { feature } = req.body || {};
  if (typeof feature !== 'string') return res.status(400).json({ error: 'feature required' });
  pausedFeatures.delete(feature);
  broadcast({ type: 'feature_resumed', feature });
  res.json(pauseState(feature));
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
