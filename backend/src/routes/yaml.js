import { Router } from 'express';
import yaml from 'js-yaml';
import { config, featureList, testCasesByFeature, featureDescriptions } from '../state/store.js';
import { broadcast } from '../services/websocket.js';
import { assignTcIds, bddFields, scenarioName } from '../services/tcIds.js';
import { replaceAllFeaturesAndCases, appendFeaturesAndCases } from '../state/db.js';
import { planAddToSuite } from '../services/suiteMerge.js';

const router = Router();

router.get('/export', (req, res) => {
  const doc = {
    targetUrl: config.targetUrl,
    features: featureList.map(feat => ({
      name: feat,
      ...(featureDescriptions[feat] ? { description: featureDescriptions[feat] } : {}),
      testCases: (testCasesByFeature[feat] || []).map(tc => ({
        id: tc.id, scenario: tc.title,
        given: tc.given, when: tc.when, then: tc.then,
      })),
    })),
  };
  res.setHeader('Content-Type', 'text/yaml');
  res.setHeader('Content-Disposition', 'attachment; filename="test-suite.yaml"');
  res.send(yaml.dump(doc, { lineWidth: 120, quotingType: '"' }));
});

// POST /api/import            replace the whole suite with the file (the editor's save uses this too)
// POST /api/import?mode=add   "Add to suite": keep everything, merge same-name features, skip same-title cases
//   &dryRun=1                 only return the plan; nothing is written
router.post('/import', (req, res) => {
  let doc;
  try {
    const raw = req.headers['content-type']?.includes('yaml') ? req.body : (req.body.yaml || '');
    if (!raw) return res.status(400).json({ error: 'No YAML content provided' });
    doc = yaml.load(raw);
  } catch (e) {
    return res.status(400).json({ error: `YAML parse error: ${e.message}` });
  }
  // Files exported before the Module -> Feature rename use `modules:`.
  if (doc && !Array.isArray(doc.features) && Array.isArray(doc.modules)) doc.features = doc.modules;
  if (!doc || !Array.isArray(doc.features)) return res.status(400).json({ error: 'Expected { features: [...] }' });
  if (req.query.mode === 'add') return addToSuite(doc, req.query.dryRun === '1', res);
  assignTcIds(doc.features);   // old MD001-TC001 ids (and missing ids) become TC001, TC002, ...

  const summary = { featuresAdded: 0, featuresUpdated: 0, casesImported: 0, featuresRemoved: 0 };
  const incomingNames = doc.features.map(m => (m.name || '').trim()).filter(Boolean);

  // Remove features not present in the imported doc (honour deletions)
  const toRemove = featureList.filter(m => !incomingNames.includes(m));
  for (const name of toRemove) {
    featureList.splice(featureList.indexOf(name), 1);
    delete testCasesByFeature[name];
    delete featureDescriptions[name];
    summary.featuresRemoved++;
  }

  for (const featDef of doc.features) {
    const name = (featDef.name || '').trim();
    if (!name) continue;
    if (!featureList.includes(name)) { featureList.push(name); summary.featuresAdded++; }
    else summary.featuresUpdated++;
    featureDescriptions[name] = String(featDef.description || '').trim();
    if (Array.isArray(featDef.testCases)) {
      // Full replace of TCs for this feature on import
      testCasesByFeature[name] = [];
      for (const tc of featDef.testCases) {
        const scenario = scenarioName(tc);
        if (!scenario) continue;
        testCasesByFeature[name].push({
          id: tc.id, feature: name, title: scenario, status: 'PENDING',
          ...bddFields(tc),
        });
        summary.casesImported++;
      }
    }
  }
  if (doc.targetUrl) { try { new URL(doc.targetUrl); config.targetUrl = doc.targetUrl; } catch { /* ignore */ } }
  replaceAllFeaturesAndCases(featureList, testCasesByFeature, featureDescriptions);
  broadcast({ type: 'config', targetUrl: config.targetUrl, features: featureList });
  broadcast({ type: 'cases_updated', feature: null });
  res.json({ ok: true, summary });
});

// The file's targetUrl is ignored here: adding cases should not move the suite to another app.
function addToSuite(doc, dryRun, res) {
  const plan = planAddToSuite({ featureList, testCasesByFeature, featureDescriptions }, doc.features);
  const view = plan.features.map(g => ({
    name: g.name, status: g.status, backgroundDiffers: g.backgroundDiffers,
    add: g.add.map(tc => ({ id: tc.id, title: tc.title })),
    skip: g.skip,
  }));
  if (dryRun) return res.json({ ok: true, dryRun: true, summary: plan.summary, features: view });

  const added = plan.features.filter(g => g.status === 'added');
  const cases = plan.features.flatMap(g => g.add);
  appendFeaturesAndCases(added.map(g => ({ name: g.name, description: g.background })), cases);
  for (const g of added) {
    featureList.push(g.name);
    featureDescriptions[g.name] = g.background;
    testCasesByFeature[g.name] = [];
  }
  for (const tc of cases) testCasesByFeature[tc.feature].push(tc);

  if (added.length) broadcast({ type: 'config', targetUrl: config.targetUrl, features: featureList });
  broadcast({ type: 'cases_updated', feature: null });
  res.json({ ok: true, dryRun: false, summary: plan.summary, features: view });
}

export default router;
