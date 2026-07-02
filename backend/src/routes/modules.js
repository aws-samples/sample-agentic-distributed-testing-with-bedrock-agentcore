import { Router } from 'express';
import { moduleList, testCasesByModule } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { killSession } from '../services/sessions.js';
import { nextTcId, normArray } from '../services/tcIds.js';

const router = Router();

router.get('/modules', (req, res) => res.json({ modules: moduleList }));

router.post('/modules', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const modName = name.trim();
  if (moduleList.includes(modName)) return res.status(409).json({ error: 'Module already exists' });
  moduleList.push(modName);
  testCasesByModule[modName] = [];
  broadcast({ type: 'module_added', module: modName, modules: moduleList });
  res.json({ module: modName, modules: moduleList });
});

router.delete('/modules/:name', async (req, res) => {
  const modName = decodeURIComponent(req.params.name);
  const idx = moduleList.indexOf(modName);
  if (idx === -1) return res.status(404).json({ error: 'Module not found' });
  moduleList.splice(idx, 1);
  delete testCasesByModule[modName];
  await killSession(modName);
  broadcast({ type: 'module_removed', module: modName, modules: moduleList });
  res.json({ modules: moduleList });
});

router.get('/modules/:module/cases', (req, res) => {
  const mod = decodeURIComponent(req.params.module);
  res.json({ module: mod, cases: testCasesByModule[mod] || [] });
});

router.post('/modules/:module/cases', (req, res) => {
  const mod = decodeURIComponent(req.params.module);
  if (!moduleList.includes(mod)) return res.status(404).json({ error: 'Module not found' });
  const { id, title, preconditions, steps, expectedResult } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!testCasesByModule[mod]) testCasesByModule[mod] = [];
  const tc = {
    id: id || nextTcId(mod), module: mod, title: title.trim(), status: 'PENDING',
    preconditions: normArray(preconditions),
    steps: Array.isArray(steps) ? steps : [steps || ''],
    expectedResult: normArray(expectedResult),
  };
  testCasesByModule[mod].push(tc);
  broadcast({ type: 'cases_updated', module: mod });
  res.status(201).json(tc);
});

router.patch('/cases/:tcId', (req, res) => {
  const { tcId } = req.params;
  for (const mod of Object.keys(testCasesByModule)) {
    const tc = testCasesByModule[mod].find(t => t.id === tcId);
    if (tc) {
      const { title, preconditions, steps, expectedResult } = req.body;
      if (title !== undefined) tc.title = title;
      if (preconditions !== undefined) tc.preconditions = normArray(preconditions);
      if (steps !== undefined) tc.steps = steps;
      if (expectedResult !== undefined) tc.expectedResult = expectedResult;
      broadcast({ type: 'cases_updated', module: mod });
      return res.json(tc);
    }
  }
  res.status(404).json({ error: 'Test case not found' });
});

router.delete('/cases/:tcId', (req, res) => {
  const { tcId } = req.params;
  for (const mod of Object.keys(testCasesByModule)) {
    const idx = testCasesByModule[mod].findIndex(t => t.id === tcId);
    if (idx !== -1) {
      testCasesByModule[mod].splice(idx, 1);
      broadcast({ type: 'cases_updated', module: mod });
      return res.json({ ok: true });
    }
  }
  res.status(404).json({ error: 'Test case not found' });
});

export default router;
