/**
 * Connection test and schema draft for the Settings → Databases editor.
 * Read-only: connects, runs fixed introspection statements inside a READ ONLY transaction,
 * rolls back. (The agent's own tools, with the statement guard, live in the runtimes'
 * db-server.js.)
 */
import net from 'node:net';
import { resolveAllowedHost } from './netGuard.js';

const TIMEOUT_MS = 8000;

async function withConn(c, fn) {
  // Connect to the address that passed the link-local check; the certificate is still checked against the hostname.
  const address = await resolveAllowedHost(c.host);
  const servername = net.isIP(c.host) ? undefined : c.host;
  const ssl = c.ssl === 'off' ? undefined
    : { rejectUnauthorized: c.ssl === 'verify', servername, ...(c.ssl === 'verify' && c.sslCa ? { ca: c.sslCa } : {}) };
  if (c.type === 'postgres') {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      host: address, port: c.port, database: c.database, user: c.user, password: c.password,
      ssl: ssl || false, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS + 2000,
    });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      return await fn(async (sql) => (await client.query(sql)).rows);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  }
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: address, port: c.port, database: c.database || undefined, user: c.user, password: c.password,
    ssl, connectTimeout: TIMEOUT_MS, multipleStatements: false,
  });
  try {
    await conn.query('START TRANSACTION READ ONLY');
    return await fn(async (sql) => (await conn.query({ sql, timeout: TIMEOUT_MS }))[0]);
  } finally {
    await conn.query('ROLLBACK').catch(() => {});
    await conn.end().catch(() => {});
  }
}

/** Never let a driver error carry the password back to the browser. */
export function safeMessage(e, c) {
  let m = String(e?.message || e || 'Connection failed');
  if (c?.password) m = m.split(c.password).join('***');
  return m.slice(0, 300);
}

export async function testConnection(c) {
  const version = await withConn(c, async (q) => {
    const rows = await q(c.type === 'postgres' ? 'SELECT version() AS v' : 'SELECT VERSION() AS v');
    return String(rows[0]?.v || '').slice(0, 80);
  });
  return `Connected (${version})`;
}

/** A starting point for the description: tables and columns from the live schema, for the tester to edit. */
export async function schemaDraft(c) {
  const rows = await withConn(c, (q) => q(c.type === 'postgres'
    ? `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema, table_name, ordinal_position`
    : `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position`));
  const tables = new Map();
  for (const r of rows) {
    if (!tables.has(r.t)) tables.set(r.t, []);
    tables.get(r.t).push(`${r.c} ${r.d}`);
  }
  let out = 'Tables (edit: say what each holds, what the status codes mean, and add example queries):\n';
  for (const [t, cols] of tables) out += `- ${t}(${cols.join(', ')}): \n`;
  return out.slice(0, 3900);
}
