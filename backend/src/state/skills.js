/**
 * Skills (reusable instructions for the testing agent, global to every run), the tool
 * switches, and the one-time changes made to an existing config: the CardDemo default
 * connection and the move of per-connection descriptions into skills.
 */

export const SKILL_LIMITS = { count: 50, name: 80, text: 4000 };
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** Tools the Settings → Tools tab lists. Runtimes keep their own id → tool server table. */
export const TOOLS = [{ id: 'database', name: 'Database', server: 'db' }];
export const TOOL_IDS = TOOLS.map(t => t.id);

/** { [toolId]: { enabled } } for every known tool (on unless switched off). Unknown ids are dropped. */
export function normalizeTools(t) {
  return Object.fromEntries(TOOLS.map(({ id }) => [id, { enabled: t?.[id]?.enabled !== false }]));
}

export function normalizeSkills(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, SKILL_LIMITS.count).map(s => ({
    id: ID_RE.test(String(s?.id)) ? String(s.id) : `s_${Math.random().toString(36).slice(2, 10)}`,
    name: String(s?.name ?? '').trim().slice(0, SKILL_LIMITS.name),
    text: String(s?.text ?? '').slice(0, SKILL_LIMITS.text),
    tool: TOOL_IDS.includes(s?.tool) ? s.tool : null,
    enabled: s?.enabled !== false,
  })).filter(s => s.name && !seen.has(s.id) && seen.add(s.id));
}

/** Enabled skills the agent gets: general ones, and those attached to an enabled tool. */
export function skillsForRun(skills, tools) {
  return skills.filter(s => s.enabled && (!s.tool || tools[s.tool]?.enabled))
    .map(({ name, text, tool }) => ({ name, text, tool }));
}

// ─── CardDemo default ─────────────────────────────────────────────────────────

export const CARDDEMO_FILE = '/sample-app-data/carddemo.db';
export const CARDDEMO_CONNECTION = {
  name: 'CardDemo', type: 'sqlite', host: '', port: 0, database: CARDDEMO_FILE, user: '', password: '',
  ssl: 'off', sslCa: '', description: '', logResults: true, sample: true,
};
export const CARDDEMO_SKILL = {
  id: 'carddemo-database', name: 'CardDemo database', tool: 'database', enabled: true,
  text: `Connection CardDemo is the sample credit card app's SQLite database (read-only). Tables: users(user_id, user_type A=admin U=user), customers(customer_id, names, fico_score), accounts(account_id, active_status Y/N, current_balance, credit_limit, current_cycle_credit, current_cycle_debit, group_id), cards(card_num, account_id, active_status Y/N, expiration_date), card_xref(card_num, account_id, customer_id: links a card to its account and customer), transactions(tran_id, card_num, type_code, category_code, description, amount, merchant_name, orig_timestamp, proc_timestamp), transaction_types(type_code, type_description), transaction_categories(type_code, category_code), transaction_category_balances, disclosure_groups(group_id, interest_rate), daily_transactions (same columns as transactions, not yet posted). Dates are text. Amounts are REAL. After a transfer or payment, check the newest row: SELECT tran_id, card_num, amount, description, proc_timestamp FROM transactions WHERE card_num = '<card>' ORDER BY proc_timestamp DESC LIMIT 3; and the account balance: SELECT current_balance FROM accounts WHERE account_id = '<account>'. Never filter by guessing a column; describe the table first.`,
};

/**
 * One-time changes, guarded by flags so running again changes nothing. `state` is
 * { dbConnections, skills, flags }; `backup()` is called once before the first migration of a
 * config that has a saved file. Returns { state, changed }.
 */
export function applyDefaults(state, backup = () => {}) {
  let { dbConnections, skills, flags } = state;
  flags = { ...flags };
  let changed = false;
  if (!flags.skillsMigrated) {
    const moved = dbConnections.filter(c => String(c.description || '').trim());
    if (moved.length) backup();
    skills = [...skills];
    for (const c of moved) {
      const id = `migrated-${c.name}`.slice(0, 80);
      if (!skills.some(s => s.id === id)) skills.push({ id, name: `${c.name} notes`.slice(0, SKILL_LIMITS.name), text: String(c.description).slice(0, SKILL_LIMITS.text), tool: 'database', enabled: true });
    }
    dbConnections = dbConnections.map(c => ({ ...c, description: '' }));
    flags.skillsMigrated = true; changed = true;
  }
  if (!flags.cardDemoSeeded) {
    if (!dbConnections.length) {
      dbConnections = [{ ...CARDDEMO_CONNECTION }];
      if (!skills.some(s => s.id === CARDDEMO_SKILL.id)) skills = [...skills, { ...CARDDEMO_SKILL }];
    }
    flags.cardDemoSeeded = true; changed = true;   // set even when connections exist: deleting CardDemo later must not bring it back
  }
  return { state: { dbConnections, skills, flags }, changed };
}
