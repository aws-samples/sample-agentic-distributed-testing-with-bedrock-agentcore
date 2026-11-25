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
