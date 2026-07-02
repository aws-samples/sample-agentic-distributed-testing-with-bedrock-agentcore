import { Router } from 'express';
import yaml from 'js-yaml';
import { config, moduleList, testCasesByModule } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { nextTcId, normArray } from '../services/tcIds.js';

const router = Router();

router.get('/export', (req, res) => {
  const doc = {
    targetUrl: config.targetUrl,
    modules: moduleList.map(mod => ({
      name: mod,
      testCases: (testCasesByModule[mod] || []).map(tc => ({
        id: tc.id, title: tc.title,
        preconditions: tc.preconditions, steps: tc.steps, expectedResult: tc.expectedResult,
      })),
    })),
  };
  res.setHeader('Content-Type', 'text/yaml');
  res.setHeader('Content-Disposition', 'attachment; filename="test-suite.yaml"');
  res.send(yaml.dump(doc, { lineWidth: 120, quotingType: '"' }));
});

router.post('/import', (req, res) => {
  let doc;
  try {
    const raw = req.headers['content-type']?.includes('yaml') ? req.body : (req.body.yaml || '');
    if (!raw) return res.status(400).json({ error: 'No YAML content provided' });
    doc = yaml.load(raw);
  } catch (e) {
    return res.status(400).json({ error: `YAML parse error: ${e.message}` });
  }
  if (!doc || !Array.isArray(doc.modules)) return res.status(400).json({ error: 'Expected { modules: [...] }' });

  const summary = { modulesAdded: 0, modulesUpdated: 0, casesImported: 0, modulesRemoved: 0 };
  const incomingNames = doc.modules.map(m => (m.name || '').trim()).filter(Boolean);

  // Remove modules not present in the imported doc (honour deletions)
  const toRemove = moduleList.filter(m => !incomingNames.includes(m));
  for (const name of toRemove) {
    moduleList.splice(moduleList.indexOf(name), 1);
    delete testCasesByModule[name];
    summary.modulesRemoved++;
  }

  for (const modDef of doc.modules) {
    const name = (modDef.name || '').trim();
    if (!name) continue;
    if (!moduleList.includes(name)) { moduleList.push(name); summary.modulesAdded++; }
    else summary.modulesUpdated++;
    if (Array.isArray(modDef.testCases)) {
      // Full replace of TCs for this module on import
      testCasesByModule[name] = [];
      for (const tc of modDef.testCases) {
        if (!tc.title) continue;
        testCasesByModule[name].push({
          id: tc.id || nextTcId(name), module: name, title: tc.title, status: 'PENDING',
          preconditions: normArray(tc.preconditions),
          steps: Array.isArray(tc.steps) ? tc.steps : [tc.steps || ''],
          expectedResult: normArray(tc.expectedResult),
        });
        summary.casesImported++;
      }
    }
  }
  if (doc.targetUrl) { try { new URL(doc.targetUrl); config.targetUrl = doc.targetUrl; } catch { /* ignore */ } }
  broadcast({ type: 'config', targetUrl: config.targetUrl, modules: moduleList });
  broadcast({ type: 'cases_updated', module: null });
  res.json({ ok: true, summary });
});

export default router;
