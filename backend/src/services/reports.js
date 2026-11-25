/**
 * Pure helpers that turn an archived RunRecord (state/archive.js) into a CI
 * verdict, a JUnit XML document and a self-contained HTML report.
 */

// XML 1.0 forbids most control characters; drop them rather than emit a file
// parsers reject. Then escape the five markup characters (also valid for HTML).
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
export function esc(v) {
  return String(v ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function allCases(record) {
  const out = [];
  for (const [feature, f] of Object.entries(record.features || {})) {
    for (const c of f.cases || []) out.push({ feature, ...c });
  }
  return out;
}

/**
 * state: running | completed. exitCode (only once completed):
 * 0 all passed, 1 at least one FAIL, 2 run incomplete (stopped, or cases never ran).
 */
export function ciVerdict(record) {
  const s = record.summary || { total: 0, pass: 0, fail: 0, pending: 0 };
  if (!record.completedAt) return { state: 'running', exitCode: null, summary: s };
  let exitCode = 0;
  if (s.fail > 0) exitCode = 1;
  else if (record.stopped || s.pending > 0 || s.total === 0) exitCode = 2;
  return { state: 'completed', exitCode, summary: s };
}

export function toJUnit(record) {
  const byFeature = new Map();
  for (const c of allCases(record)) {
    if (!byFeature.has(c.feature)) byFeature.set(c.feature, []);
    byFeature.get(c.feature).push(c);
  }
  const suites = [...byFeature].map(([feature, cases]) => {
    const failures = cases.filter(c => c.status === 'FAIL').length;
    const skipped = cases.filter(c => c.status !== 'PASS' && c.status !== 'FAIL').length;
    const body = cases.map(c => {
      const head = `<testcase classname="${esc(feature)}" name="${esc(`${c.id} ${c.title}`)}" time="0">`;
      if (c.status === 'FAIL') return `    ${head}<failure message="${esc((c.reason || 'failed').slice(0, 200))}">${esc(c.reason)}</failure></testcase>`;
      if (c.status !== 'PASS') return `    ${head}<skipped message="${esc(c.status)}"/></testcase>`;
      return `    ${head}</testcase>`;
    }).join('\n');
    return `  <testsuite name="${esc(feature)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" timestamp="${esc(record.startedAt)}">\n${body}\n  </testsuite>`;
  }).join('\n');
  const s = record.summary || {};
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${esc(record.runId)}" tests="${s.total || 0}" failures="${s.fail || 0}">\n${suites}\n</testsuites>\n`;
}

const COLORS = { PASS: '#1a7f37', FAIL: '#cf222e' };

export function toHtml(record) {
  const s = record.summary || {};
  const rows = allCases(record).map(c => `<tr><td>${esc(c.feature)}</td><td>${esc(c.id)}</td><td>${esc(c.title)}</td>` +
    `<td style="color:${COLORS[c.status] || '#57606a'};font-weight:600">${esc(c.status)}</td><td>${esc(c.reason)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Run ${esc(record.runId)}</title>
<style>body{font:14px system-ui,sans-serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f6f8fa}</style>
</head><body>
<h1>Test run ${esc(record.runId)}</h1>
<p>Started ${esc(record.startedAt)} &middot; Completed ${esc(record.completedAt || 'in progress')} &middot; Target ${esc(record.targetUrl)}${record.stopped ? ' &middot; stopped early' : ''}</p>
<p><b>${esc(s.total)}</b> total &middot; <b>${esc(s.pass)}</b> passed &middot; <b>${esc(s.fail)}</b> failed &middot; <b>${esc(s.pending)}</b> not run</p>
<table><thead><tr><th>Feature</th><th>ID</th><th>Scenario</th><th>Status</th><th>Reason</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>
`;
}
