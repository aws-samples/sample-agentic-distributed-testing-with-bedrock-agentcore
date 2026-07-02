import { moduleList, testCasesByModule } from '../state/store.js';

export function modulePrefix(mod) {
  const idx = moduleList.indexOf(mod);
  const n = idx >= 0 ? idx + 1 : moduleList.length + 1;
  return `MD${String(n).padStart(3, '0')}`;
}

export function nextTcId(mod) {
  const existing = testCasesByModule[mod] || [];
  const prefix = modulePrefix(mod);
  const nums = existing
    .map(t => { const m = t.id?.match(/TC(\d+)$/); return m ? parseInt(m[1], 10) : 0; })
    .filter(Boolean);
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}-TC${String(next).padStart(3, '0')}`;
}

export function normArray(val) {
  if (Array.isArray(val)) return val;
  return val ? [val] : [];
}
