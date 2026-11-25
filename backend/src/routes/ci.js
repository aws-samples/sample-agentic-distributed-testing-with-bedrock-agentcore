/**
 * Token-protected endpoints for CI: start a run, poll it, download JUnit XML /
 * HTML reports. Mounted at /api/ci by index.js and outside the Cognito gate;
 * authenticated with a static bearer secret (env CI_API_TOKEN). With none set
 * the endpoints answer 503, so the trigger is never open by default.
 *
 * Dependencies are injected so the router can be tested without the store/DB.
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import crypto from 'crypto';
import { ciVerdict, toJUnit, toHtml } from '../services/reports.js';

const RUN_ID_RE = /^run-\d{1,20}$/;
const MAX_NAMES = 100;

const digest = s => crypto.createHash('sha256').update(String(s)).digest();

export function createCiRouter({ startRun, runArchive, testCasesByFeature, isBusy, getSecret = () => process.env.CI_API_TOKEN || '' }) {
  const router = Router();

  // Applies to every route here, including failed-auth requests (slows guessing).
  router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));

  router.use((req, res, next) => {
    const secret = getSecret();
    if (!secret) return res.status(503).json({ error: 'CI API disabled: set CI_API_TOKEN' });
    const header = req.headers.authorization || '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!crypto.timingSafeEqual(digest(given), digest(secret))) return res.status(401).json({ error: 'Unauthorized' });
    next();
  });

  // Body: { all: true } | { features: ["Login"] } | { testCaseIds: ["TC001"] }
  router.post('/runs', (req, res) => {
    const body = req.body || {};
    const names = v => (Array.isArray(v) && v.length <= MAX_NAMES && v.every(x => typeof x === 'string') ? v : null);
    const features = body.features === undefined ? null : names(body.features);
    const ids = body.testCaseIds === undefined ? null : names(body.testCaseIds);
    if ((body.features !== undefined && !features) || (body.testCaseIds !== undefined && !ids)) {
      return res.status(400).json({ error: `features / testCaseIds must be arrays of at most ${MAX_NAMES} strings` });
    }
    if (body.all !== true && !features && !ids) {
      return res.status(400).json({ error: 'Select tests with features, testCaseIds or all:true' });
    }

    // Iterate the store's own feature names; user input is only used for Set membership.
    const known = Object.keys(testCasesByFeature);
    const wantFeatures = features ? new Set(features) : null;
    const wantIds = ids ? new Set(ids) : null;
    const selected = [];
    for (const feat of known) {
      if (wantFeatures && !wantFeatures.has(feat)) continue;
      for (const tc of testCasesByFeature[feat] || []) {
        if (!wantIds || wantIds.has(tc.id)) selected.push(tc);
      }
    }
    if (!selected.length) return res.status(404).json({ error: 'No matching test cases' });
    if (isBusy()) return res.status(409).json({ error: 'A run is already in progress' });

    const runId = startRun(selected);
    res.status(202).json({ runId, total: selected.length, statusUrl: `/api/ci/runs/${runId}` });
  });

  function find(req, res) {
    const { runId } = req.params;
    const record = RUN_ID_RE.test(runId) ? runArchive.find(r => r.runId === runId) : null;
    if (!record) { res.status(404).json({ error: 'Run not found' }); return null; }
    return record;
  }

  router.get('/runs/:runId', (req, res) => {
    const record = find(req, res);
    if (record) res.json({ runId: record.runId, ...ciVerdict(record) });
  });

  router.get('/runs/:runId/junit.xml', (req, res) => {
    const record = find(req, res);
    if (record) res.type('application/xml').send(toJUnit(record));
  });

  router.get('/runs/:runId/report.html', (req, res) => {
    const record = find(req, res);
    if (record) res.type('html').send(toHtml(record));
  });

  return router;
}
