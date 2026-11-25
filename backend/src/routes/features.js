import { Router } from 'express';
import { featureList, testCasesByFeature, featureDescriptions } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { killSession } from '../services/sessions.js';
import { nextTcId, normArray, bddFields, isCurrentTcId } from '../services/tcIds.js';
import { insertFeature, deleteFeature, upsertCase, deleteCase as deleteCaseRow } from '../state/db.js';

const router = Router();

router.get('/features', (req, res) => res.json({ features: featureList, descriptions: featureDescriptions }));

router.post('/features', (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const featName = name.trim();
  if (featureList.includes(featName)) return res.status(409).json({ error: 'Feature already exists' });
  featureList.push(featName);
  testCasesByFeature[featName] = [];
  featureDescriptions[featName] = String(description || '').trim();
  insertFeature(featName, featureDescriptions[featName]);
  broadcast({ type: 'feature_added', feature: featName, features: featureList });
  res.json({ feature: featName, features: featureList });
});

router.delete('/features/:name', async (req, res) => {
  const featName = decodeURIComponent(req.params.name);
  const idx = featureList.indexOf(featName);
  if (idx === -1) return res.status(404).json({ error: 'Feature not found' });
  featureList.splice(idx, 1);
  delete testCasesByFeature[featName];
  delete featureDescriptions[featName];
  deleteFeature(featName); // ON DELETE CASCADE also removes this feature's test_cases rows
  await killSession(featName);
  broadcast({ type: 'feature_removed', feature: featName, features: featureList });
  res.json({ features: featureList });
});

router.get('/features/:feature/cases', (req, res) => {
  const feat = decodeURIComponent(req.params.feature);
  res.json({ feature: feat, cases: testCasesByFeature[feat] || [] });
});

// Limits for a hand-written test case. Generous for real scenarios, small enough
// that one request cannot store an unbounded blob.
export const CASE_LIMITS = { title: 300, steps: 50, step: 2000 };

// A Given / When / Then value from a request: a string or an array of strings.
// Returns the step list, or null when the value has the wrong shape or size.
function stepList(val) {
  if (val === undefined || val === null) return [];
  const list = Array.isArray(val) ? val : [val];
  if (list.length > CASE_LIMITS.steps) return null;
  if (!list.every(s => typeof s === 'string' && s.length <= CASE_LIMITS.step)) return null;
  return list;
}

function caseIdInUse(id) {
  return Object.values(testCasesByFeature).some(cases => cases.some(t => t.id === id));
}

// Create one test case in a feature (a blank or hand-written scenario; no AI call).
// A client-supplied id is kept only when it is a free TC### id: ids are global,
// and reusing one would overwrite a case in another feature.
router.post('/features/:feature/cases', (req, res) => {
  const feat = decodeURIComponent(req.params.feature);
  if (!featureList.includes(feat)) return res.status(404).json({ error: 'Feature not found' });
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'title required' });
  if (title.length > CASE_LIMITS.title) return res.status(400).json({ error: `title longer than ${CASE_LIMITS.title} characters` });
  const given = stepList(body.given), when = stepList(body.when), then = stepList(body.then);
  if (!given || !when || !then) {
    return res.status(400).json({ error: `given, when and then must be strings or lists of up to ${CASE_LIMITS.steps} strings of at most ${CASE_LIMITS.step} characters` });
  }
  const id = isCurrentTcId(body.id) && !caseIdInUse(body.id) ? body.id : nextTcId();
  if (!Array.isArray(testCasesByFeature[feat])) testCasesByFeature[feat] = [];
  const tc = {
    id, feature: feat, title, status: 'PENDING',
    ...bddFields({ given, when, then }),
  };
  testCasesByFeature[feat].push(tc);
  upsertCase(tc);
  broadcast({ type: 'cases_updated', feature: feat });
  res.status(201).json(tc);
});

router.patch('/cases/:tcId', (req, res) => {
  const { tcId } = req.params;
  for (const feat of Object.keys(testCasesByFeature)) {
    const tc = testCasesByFeature[feat].find(t => t.id === tcId);
    if (tc) {
      const { title, given, when, then } = req.body;
      if (title !== undefined) tc.title = title;
      if (given !== undefined) tc.given = normArray(given);
      if (when !== undefined) tc.when = when;
      if (then !== undefined) tc.then = normArray(then);
      upsertCase(tc);
      broadcast({ type: 'cases_updated', feature: feat });
      return res.json(tc);
    }
  }
  res.status(404).json({ error: 'Test case not found' });
});

router.delete('/cases/:tcId', (req, res) => {
  const { tcId } = req.params;
  for (const feat of Object.keys(testCasesByFeature)) {
    const idx = testCasesByFeature[feat].findIndex(t => t.id === tcId);
    if (idx !== -1) {
      testCasesByFeature[feat].splice(idx, 1);
      deleteCaseRow(tcId);
      broadcast({ type: 'cases_updated', feature: feat });
      return res.json({ ok: true });
    }
  }
  res.status(404).json({ error: 'Test case not found' });
});

export default router;
