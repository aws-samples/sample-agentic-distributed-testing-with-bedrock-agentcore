import { Router } from 'express';
import { featureList, testCasesByFeature, featureDescriptions } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { killSession } from '../services/sessions.js';
import { nextTcId, normArray, bddFields } from '../services/tcIds.js';
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

router.post('/features/:feature/cases', (req, res) => {
  const feat = decodeURIComponent(req.params.feature);
  if (!featureList.includes(feat)) return res.status(404).json({ error: 'Feature not found' });
  const { id, title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!testCasesByFeature[feat]) testCasesByFeature[feat] = [];
  const tc = {
    id: id || nextTcId(), feature: feat, title: title.trim(), status: 'PENDING',
    ...bddFields(req.body),
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
