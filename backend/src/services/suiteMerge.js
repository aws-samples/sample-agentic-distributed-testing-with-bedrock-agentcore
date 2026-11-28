import { formatTcId, isCurrentTcId, scenarioName, bddFields } from './tcIds.js';

// Titles count as the same when they differ only in case or spacing.
const titleKey = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Plan an "Add to suite" import: what would be added and what skipped, without
 * changing anything. Rules (issue #67):
 * - A feature whose name already exists is merged: its cases go into the existing
 *   feature and the existing Background is kept (backgroundDiffers says when the
 *   file's Background was different, so the tester knows it was not applied).
 * - Every added case gets a new id after the highest id in the suite; ids in the
 *   file are ignored, so an id clash never blocks a case.
 * - A case whose title already exists in the target feature is skipped, with the reason.
 *
 * suite: { featureList, testCasesByFeature, featureDescriptions } (the current suite)
 * featureDefs: the `features:` list of the imported file
 * Returns { summary, features: [{ name, status: 'added'|'merged', background,
 *   backgroundDiffers, add: [case], skip: [{ title, reason }] }] }
 */
export function planAddToSuite(suite, featureDefs) {
  let n = 0;
  for (const tc of Object.values(suite.testCasesByFeature).flat()) {
    if (isCurrentTcId(tc.id)) n = Math.max(n, parseInt(tc.id.slice(2), 10));
  }

  const groups = [];
  const byName = new Map();   // name -> { group, existing: Set, taken: Set }
  for (const def of Array.isArray(featureDefs) ? featureDefs : []) {
    if (!def || typeof def !== 'object') continue;
    const name = String(def.name || '').trim();
    if (!name) continue;
    const background = String(def.description || '').trim();

    let entry = byName.get(name);
    if (!entry) {
      const exists = suite.featureList.includes(name);
      const existing = new Set(exists ? (suite.testCasesByFeature[name] || []).map(tc => titleKey(String(tc.title || ''))) : []);
      const group = {
        name,
        status: exists ? 'merged' : 'added',
        background: exists ? String(suite.featureDescriptions[name] || '').trim() : background,
        backgroundDiffers: false,
        add: [],
        skip: [],
      };
      entry = { group, existing, taken: new Set(existing) };
      byName.set(name, entry);
      groups.push(group);
    }
    const { group, existing, taken } = entry;
    // Only a merge has an existing Background to differ from; a new feature takes the file's (first one wins if it repeats).
    if (group.status === 'merged' && background && background !== group.background) group.backgroundDiffers = true;

    for (const raw of Array.isArray(def.testCases) ? def.testCases : []) {
      const tc = raw && typeof raw === 'object' ? raw : {};
      const title = scenarioName(tc);
      if (!title) { group.skip.push({ title: '(no scenario name)', reason: 'no scenario name' }); continue; }
      const key = titleKey(title);
      if (taken.has(key)) {
        group.skip.push({ title, reason: existing.has(key) ? 'title already exists' : 'same title twice in this file' });
        continue;
      }
      taken.add(key);
      group.add.push({ id: formatTcId(++n), feature: name, title, status: 'PENDING', ...bddFields(tc) });
    }
  }

  const summary = {
    features: groups.length,
    featuresAdded: groups.filter(g => g.status === 'added').length,
    featuresMerged: groups.filter(g => g.status === 'merged').length,
    casesAdded: groups.reduce((s, g) => s + g.add.length, 0),
    casesSkipped: groups.reduce((s, g) => s + g.skip.length, 0),
  };
  return { summary, features: groups };
}
