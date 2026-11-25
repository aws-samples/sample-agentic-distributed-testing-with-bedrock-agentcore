import { Router } from 'express';
import { config, saveConfig, ENV_NAME_RE, DB_LIMITS, DB_TYPES, DB_SSL, normalizeDbConnections } from '../state/store.js';
import { testConnection, schemaDraft, safeMessage } from '../services/dbClient.js';

const router = Router();

// Database connections for the testing agent's read-only db tools. Like the context
// variables they are served only from here (never from GET /config), and the password is
// never served at all: the UI gets `hasPassword` and sends a password only when it changes.
const view = (c) => { const { password, ...rest } = c; return { ...rest, hasPassword: !!password }; };

router.get('/config/databases', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ connections: config.dbConnections.map(view), limits: DB_LIMITS, types: DB_TYPES });
});

/** First problem in a list of connections, or null. */
function problem(list) {
  if (list.length > DB_LIMITS.count) return `At most ${DB_LIMITS.count} connections`;
  const seen = new Set();
  for (const [i, v] of list.entries()) {
    const where = `Connection ${i + 1}`;
    const name = String(v?.name || '').trim();
    if (!ENV_NAME_RE.test(name)) return `${where}: the name must start with a letter or _ and use only letters, digits and _ (max 64)`;
    if (seen.has(name.toLowerCase())) return `${where}: ${name} appears twice`;
    seen.add(name.toLowerCase());
    if (!DB_TYPES.includes(v?.type)) return `${where} (${name}): type must be mysql or postgres`;
    if (!String(v?.host || '').trim()) return `${where} (${name}): host is required`;
    if (v?.port !== undefined && v.port !== '' && !(Number.isInteger(Number(v.port)) && Number(v.port) > 0 && Number(v.port) < 65536)) return `${where} (${name}): port must be 1-65535`;
    if (!String(v?.database || '').trim()) return `${where} (${name}): database is required`;
    if (!String(v?.user || '').trim()) return `${where} (${name}): user is required`;
    if (v?.ssl !== undefined && !DB_SSL.includes(v.ssl)) return `${where} (${name}): ssl must be ${DB_SSL.join(', ')}`;
    if (String(v?.description ?? '').length > DB_LIMITS.description) return `${where} (${name}): the description is longer than ${DB_LIMITS.description} characters`;
  }
  return null;
}

// Replaces the whole list; validated as a whole so it is never half-applied.
router.put('/config/databases', (req, res) => {
  const list = req.body?.connections;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'connections must be an array' });
  const err = problem(list);
  if (err) return res.status(400).json({ error: err });
  config.dbConnections = normalizeDbConnections(list, config.dbConnections);
  saveConfig();
  res.json({ connections: config.dbConnections.map(view) });
});

// Test / schema work on a connection as typed in the form (maybe unsaved); a missing
// password falls back to the saved connection of the same name.
function fromBody(req, res) {
  const c = req.body?.connection;
  const err = problem(c ? [c] : []) || (c ? null : 'connection required');
  if (err) { res.status(400).json({ error: err }); return null; }
  return normalizeDbConnections([c], config.dbConnections)[0];
}

router.post('/config/databases/test', async (req, res) => {
  const c = fromBody(req, res); if (!c) return;
  try { res.json({ ok: true, message: await testConnection(c) }); }
  catch (e) { res.json({ ok: false, message: safeMessage(e, c) }); }
});

router.post('/config/databases/schema', async (req, res) => {
  const c = fromBody(req, res); if (!c) return;
  try { res.json({ ok: true, draft: await schemaDraft(c) }); }
  catch (e) { res.json({ ok: false, message: safeMessage(e, c) }); }
});

export default router;
