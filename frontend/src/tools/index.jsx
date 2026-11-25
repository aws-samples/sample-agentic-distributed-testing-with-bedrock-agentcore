import DatabasesEditor from '../components/DatabasesEditor'

/**
 * Tools the testing agent can use. To add one: an entry here (name, description, a Panel for its
 * settings, and `panelProps` picking what the Panel needs from the Settings modal's shared state),
 * an entry in backend/src/state/skills.js (TOOLS) and one in each runtime's toolServers().
 */
export const TOOLS = [
  {
    id: 'database',
    name: 'Database',
    description: 'Lets the agent look at what the application stored: list tables, describe a table and run read-only SELECT queries (200 rows and 15 s at most), for example to check the ledger rows after a transfer.',
    Panel: DatabaseSettings,
    panelProps: (ctx) => ({ rows: ctx.dbRows, onChange: ctx.setDbRows, errors: ctx.dbErrors, addSkill: ctx.addSkill }),
  },
]

function DatabaseSettings({ rows, onChange, errors, disabled, api, addSkill }) {
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
        <strong>The database user must be read-only</strong> (only SELECT rights), on test or staging data, never production. The tool adds its own checks (SELECT only, a read-only transaction, row and time limits), but those are a safety net, not the permission boundary. The password is stored in the backend config and sent to the runtime with each run; it is never shown again. In AgentCore mode the database must be reachable from the runtime's network, and SQLite files are not available.
      </div>
      <DatabasesEditor rows={rows} onChange={onChange} errors={errors} disabled={disabled} api={api} addSkill={addSkill} />
    </>
  )
}
