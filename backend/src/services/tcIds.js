import { testCasesByFeature } from '../state/store.js';

const TC_NUM = /^TC(\d+)$/;

/** True for ids in the current format (TC001). Anything else (e.g. MD001-TC001) is legacy. */
export function isCurrentTcId(id) { return typeof id === 'string' && TC_NUM.test(id); }

export function formatTcId(n) { return 'TC' + String(n).padStart(3, '0'); }

function highestTcNumber(cases) {
  let max = 0;
  for (const tc of cases) {
    const m = TC_NUM.exec(tc.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** Next free id across the whole suite — ids are global, not per feature. */
export function nextTcId() {
  return formatTcId(highestTcNumber(Object.values(testCasesByFeature).flat()) + 1);
}

/**
 * For import / seed: give every case without a current-format id one, numbered
 * after the highest id in the document. Explicit TC### ids are kept as they are.
 */
export function assignTcIds(featureDefs) {
  const all = featureDefs.flatMap(f => (Array.isArray(f.testCases) ? f.testCases : []));
  let n = highestTcNumber(all);
  const seen = new Set();
  for (const tc of all) {
    if (isCurrentTcId(tc.id) && !seen.has(tc.id)) { seen.add(tc.id); continue; }
    do { tc.id = formatTcId(++n); } while (seen.has(tc.id));
    seen.add(tc.id);
  }
}

/**
 * A test case's name as written in suite files. Files say `scenario:`; files from
 * before that rename say `title:`. Both are accepted.
 */
export function scenarioName(tc) {
  return String(tc?.scenario ?? tc?.title ?? '').trim();
}

// AI-enhanced BDD fields: given / when / then. The legacy names (preconditions /
// steps / expectedResult) are still accepted on import so older exported YAML
// files keep working; everything stored and served uses the new names.
export function bddFields(tc) {
  const when = tc.when ?? tc.steps;
  return {
    given: normArray(tc.given ?? tc.preconditions),
    when: Array.isArray(when) ? when : [when || ''],
    then: normArray(tc.then ?? tc.expectedResult),
  };
}

export function normArray(val) {
  if (Array.isArray(val)) return val;
  return val ? [val] : [];
}
