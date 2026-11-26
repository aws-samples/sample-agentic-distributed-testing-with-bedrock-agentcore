import { Router } from 'express';
import { config, saveConfig } from '../state/store.js';
import { TOOLS, SKILL_LIMITS, normalizeTools, normalizeSkills } from '../state/skills.js';

const router = Router();

// Which tools the agent may use (Settings → Tools). The tool's own settings live in its own
// routes (databases: /config/databases).
router.get('/config/tools', (req, res) => {
  res.json({ tools: TOOLS.map(({ id, name }) => ({ id, name, enabled: config.tools[id].enabled })) });
});

router.put('/config/tools', (req, res) => {
  const t = req.body?.tools;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return res.status(400).json({ error: 'tools must be an object: { <tool id>: { enabled } }' });
  const unknown = Object.keys(t).find(id => !config.tools[id]);
  if (unknown) return res.status(400).json({ error: `Unknown tool: ${unknown}` });
  config.tools = normalizeTools({ ...config.tools, ...Object.fromEntries(Object.entries(t).map(([id, v]) => [id, { enabled: v?.enabled !== false }])) });
  saveConfig();
  res.json({ tools: TOOLS.map(({ id, name }) => ({ id, name, enabled: config.tools[id].enabled })) });
});

// Can the agent's browser read files on the machine it runs on? Matters for the database tool, whose
// credentials file sits on disk for the length of a run. Asked of the local runtime (it knows whether
// its Chromium has the file:// block, or whether an external Chrome is used). null = unknown or not
// applicable: AgentCore's browser is a separate managed machine, and an unreachable runtime says nothing.
router.get('/config/tools/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let browserCanReadFiles = null;
  if (config.agentMode === 'local') {
    try {
      const r = await fetch(`${process.env.LOCAL_RUNTIME_URL || 'http://localhost:4020'}/health`, { signal: AbortSignal.timeout(2000) });
      const h = await r.json();
      if (typeof h.browserCanReadFiles === 'boolean') browserCanReadFiles = h.browserCanReadFiles;
    } catch { /* runtime not reachable: unknown */ }
  }
  res.json({ agentMode: config.agentMode, browserCanReadFiles });
});

// Skills: global reusable instructions, sent to the agent as data on every run.
router.get('/config/skills', (req, res) => {
  res.json({ skills: config.skills, limits: SKILL_LIMITS, tools: TOOLS.map(({ id, name }) => ({ id, name })) });
});

// Replaces the whole list. Validated as a whole so the saved list is never half-applied.
router.put('/config/skills', (req, res) => {
  const list = req.body?.skills;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'skills must be an array' });
  if (list.length > SKILL_LIMITS.count) return res.status(400).json({ error: `At most ${SKILL_LIMITS.count} skills` });
  const ids = new Set();
  for (const [i, s] of list.entries()) {
    const where = `Skill ${i + 1}`;
    const name = String(s?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: `${where}: a name is required` });
    if (name.length > SKILL_LIMITS.name) return res.status(400).json({ error: `${where}: the name is longer than ${SKILL_LIMITS.name} characters` });
    if (String(s?.text ?? '').length > SKILL_LIMITS.text) return res.status(400).json({ error: `${where} (${name}): the text is longer than ${SKILL_LIMITS.text} characters` });
    if (s?.tool != null && !TOOLS.some(t => t.id === s.tool)) return res.status(400).json({ error: `${where} (${name}): unknown tool ${s.tool}` });
    if (s?.id !== undefined && ids.has(s.id)) return res.status(400).json({ error: `${where} (${name}): the id appears twice` });
    ids.add(s?.id);
  }
  config.skills = normalizeSkills(list);
  saveConfig();
  res.json({ skills: config.skills });
});

export default router;
