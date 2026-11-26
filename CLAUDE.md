# Agentic Test Runner — Agent Instructions

## Repository

Source repo for the **Agentic Test Runner** — an AI-powered parallel browser testing tool. The core focus is **AWS AgentCore Runtime + AgentCore Browser** orchestration using OpenCode as the agent framework.

Structure:
- `/package.json` — npm workspace root; `backend/` and `frontend/` share one `node_modules`. `npm run dev` (or `dev:backend` / `dev:frontend` separately) runs the testrunner for local iteration — see Deployment in the root README
- `backend/` — Node.js + Express orchestrator (port 4010); routes test execution to the appropriate agent runtime, streams screenshots via SSE, pushes results to frontend via WebSocket, uploads evidence snapshots to S3
- `frontend/` — React + Vite UI (dev: `npm run dev`, Vite dev server on :5173; prod build served by nginx on :5175); three pages — Editor (author/generate test cases), Runner (execute + watch live), Analysis (past runs + evidence screenshots)
- `agent-runtime-local/` — Agent runtime for local mode: OpenCode + chrome-devtools-mcp + local Chromium (port 4020)
- `agent-runtime-agentcore/` — Agent runtime for agentcore mode: OpenCode + chrome-devtools-mcp + AgentCore Browser; deployable code lives in `app/` (Dockerfile + package.json + src/), deployed to AWS via CDK in `agentcore/` (kept separate from `app/` — the `agentcore` CLI zips `codeLocation` as a raw, unfiltered asset, so CDK tooling can never share a directory with it)
- `sample-app/` — CardDemo banking app (Spring Boot + React); the application under test, not part of the test runner stack
- `docker-compose.yml` — Runs backend + frontend + agent-runtime-local
- `init-sample-app.sh` / `init-local-runtime.sh` / `init-agentcore-runtime.sh` — independent setup scripts for the sample app, `agent-runtime-local` (Docker), and the AgentCore Runtime deploy to AWS. Each supports `--destroy`; the Docker ones also `--down`. `init-agentcore-runtime.sh` prompts for the AWS region (default us-east-1) and writes region + runtime ARN to both `.env` and `backend/src/state/config.json` (the latter overrides `.env`, so both must be updated)
- No dev/prod split: `npm run dev` for local iteration, `npm run build` (`docker compose up -d --build`) to run in Docker on the machine; the platform runs on a single EC2 instance (no EKS/ALB/CloudFront/Terraform) — see the root `README.md`'s Deployment section

The frontend, backend, and sample-app are **intentionally simple Docker deployments**. The architectural interest is in the agent runtime layer.

## Test case model

Features contain test cases (Gherkin scenarios: `given` / `when` / `then`). A Feature's `description` is its Background — shared setup sent to the agent with every scenario in it. Test case ids are global and sequential (`TC001`, …); never derive an id from a feature. The word "module" was retired in favour of "feature" everywhere (DB, API `/api/features`, YAML `features:`, UI); `db.js` migrates old databases on start-up.

## Writing test cases

Never put the app's URL or a username/password in a test case. Write "the target URL", "Login with Regular User credentials", "Login with Admin credentials" (and "Logged in with ..." for a Given). The backend sends the Target URL and the Authentication accounts to the runtime with every run and the runtime prompt (`buildSystemPrompt`, both runtimes) explains the phrases. The same rule is in the AI prompts in `backend/src/routes/generate.js`. `backend/src/state/seed.yaml` follows it. Wrong-password / unknown-user negative tests may still write the bad value they test with.

## Context variables

Settings → Testing AI agent has user-defined context variables (`config.envVars`: name, value, description, secret flag). They go to the runtime in every run request as `env` and both runtimes render them in a `CONTEXT VARIABLES:` prompt section next to the built-in `TARGET_URL`; the description tells the agent *when* to use each one. Values are served only from `GET/PUT /api/config/env` (never `GET /api/config`), names are validated server-side and `TARGET_URL` is reserved. Prompt text treats values as data, not instructions.

## Tools and skills (Settings tabs)

Settings has tabs General / Tools / Skills. Tools: `frontend/src/tools/index.jsx` is the registry (id, name, description, `Panel`, `panelProps`); `backend/src/state/skills.js` has the matching `TOOLS` list, skills normalisation, `skillsForRun` and `applyDefaults`; each runtime has `toolServers()` in `db-util.js` (tool id → MCP server). A second tool = one entry in each of the three. `config.tools` (`{ id: { enabled } }`), `config.skills` (`{ id, name, text, tool|null, enabled }`, global, max 50 × 4000 chars) and `config.flags` (`skillsMigrated`, `cardDemoSeeded`) persist in config.json; routes in `backend/src/routes/tools.js` (`GET/PUT /api/config/tools`, `/api/config/skills`). The run request carries `tools: [{ id, config }]` (enabled only; the database tool's config is `{ connections }`) and `skills: [{ name, text, tool }]` (enabled, tool on); the runtimes render a `SKILLS:` section (`buildSkillsSection`, data not instructions). `applyDefaults` runs at store load: moves connection descriptions into skills once (backs up config.json first) and seeds the `CardDemo` SQLite connection + starter skill when there are no connections; both guarded by flags. SQLite connections (`type: 'sqlite'`, file path in `database`, no host/user/password) are checked against `DB_SQLITE_DIRS` (default `/sample-app-data`) with `resolveSqlitePath` (copies in `db-util.js` and `dbClient.js`), read through `db-sqlite.js` (child process + kill at the timeout), and are not sent to the AgentCore runtime. The sample volume name comes from `SAMPLE_APP_DB_VOLUME` (compose external volume; `init-sample-volume.sh` creates it). OpenCode is pinned in both Dockerfiles (`ARG OPENCODE_VERSION`); `test/opencode-permissions.test.js` checks the deny keys against it (`OPENCODE_BIN`).

## Database connections

Settings → Testing AI agent has database connections (`config.dbConnections`: name, type `mysql`|`postgres`|`sqlite`, host, port, database, user, password, ssl `require`|`verify`|`off` (default `require`), sslCa, description, logResults). The database user must be read-only; the tool-side checks are a safety net, and there is no write mode. Routes live in `backend/src/routes/databases.js` (`GET/PUT /api/config/databases`, `POST .../test`, `POST .../schema`); `GET /api/config/databases` returns `hasPassword`, never the password, and `GET /api/config` returns neither. A saved password is reused for a request without one only when type, host, port and user are unchanged (`needsPasswordReentry` in `store.js`), otherwise 400. Test/schema connect through `services/netGuard.js`, which blocks link-local and metadata addresses. The run request carries them in the database tool's config (`tools`; older backends sent `databases`); both runtimes write them (`withDbCredentials` in `db-util.js`, removed in a `finally`, on SIGTERM/SIGINT and on exit; the file lives for the whole run) to a `0600` file in its own temp directory (outside the agent's work dir, removed in a `finally` when the run ends; `db-server.js` keeps it so a restarted server still has its connections; OpenCode starts that server, so there is no pipe), the local runtime image blocks `file://` in Chromium with a managed policy (`agent-runtime-local/chromium-policy.json`, installed by the Dockerfile; the runtime warns when it is missing), turn OpenCode's shell/file/web tools off (`DISABLED_BUILTIN_TOOLS`), register the `db` MCP server (`db-server.js`: `db_list_tables`, `db_describe_table`, `db_query`) and render a `DATABASES:` prompt section (`buildDbSection`) where descriptions are data, not instructions. Read-only is enforced in `db-util.js` `checkReadOnly` plus a READ ONLY transaction, a cap that stops reading at 200 rows, a byte cap and a timeout. `db-util.js` and `db-server.js` are identical copies in `agent-runtime-local/src` and `agent-runtime-agentcore/app/src` (a test fails if they drift). Queries and results (masked, truncated, unless the connection's `logResults` is off) reach the per-test-case log as `[db_query] ...` lines. The run endpoints of both runtimes are rate-limited and `sessionName` is checked against prototype-pollution keys (CodeQL). Tests: `npm test --workspace backend`, `npm test` in `agent-runtime-local` (live-database tests run when `DB_TEST_PG` / `DB_TEST_MYSQL` are set).

## Target URL health check

`POST /api/config/target-url/health` (body `{url}`, behind the `/api` auth gate) backs the Editor's Health check button. It checks a saved or unsaved URL from the backend machine (not from AgentCore Browser), never changes config, and returns `{ok, status, responseTimeMs, finalUrl, reason, checkedFrom}` with no response body. Logic is in `backend/src/services/targetHealth.js`: http/https only, 5 s total timeout (including DNS), up to 5 manually followed redirects each re-validated, and the request connects to the address it resolved and validated. Link-local addresses (including IPv4-mapped IPv6 and the AWS IPv6 metadata range) are blocked. Loopback and private ranges are allowed on purpose, because the app under test is usually local or on a private network. Tests: `cd backend && npm test`.

## Agent Modes

The orchestration platform is one app that can drive either runtime — selectable at runtime in Settings (`AGENT_MODE` is just the initial default). Both modes use OpenCode as the agent framework. The only difference is how Chrome is provisioned:

- `AGENT_MODE=local` → `agent-runtime-local/`: OpenCode + local Chromium managed via CDP
- `AGENT_MODE=agentcore` → AWS AgentCore Runtime running `agent-runtime-agentcore/`: OpenCode + AgentCore Browser (managed Chrome)

Settings has two sections. *Orchestration platform*: theme, and the Bedrock model + region the backend uses for its own AI (Edit with AI, drafting from a spec) — `config.bedrockModel` / `bedrockRegion`. *Testing AI agent*: mode, and the Bedrock model + region the agent runs on — `config.agentModel` / `agentRegion`, sent in every run request and applied by both runtimes (`resolveModelAndRegion`), falling back to the env they started with. Keep the two pairs separate. The AgentCore Runtime/Browser region is fixed at deploy time by `init-agentcore-runtime.sh` and shown read-only in Settings. Connect never deploys the runtime — it must already exist. See `backend/src/state/store.js` for the full config surface and `README.md` for the environment variable defaults.

## Safety

- Never commit secrets, tokens, or credentials (AWS account IDs, ARNs with real account numbers, API keys, live infrastructure identifiers)
- Never run `git commit` or `git push` unless the user explicitly tells you to do so in that moment
- If you add a commit, include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit message
- This repo is sample code, MIT-0 licensed (see `LICENSE`), for non-production usage — every new package/subproject should declare `"license": "MIT-0"` (or the Maven `<licenses>` equivalent) and, if it touches anything that reads as sensitive (auth flows, seeded "PII"-shaped data like `sample-app`'s CardDemo records, demo credentials), carry the same "sample code, non-production, work with security/legal before deployment" disclaimer already in the root and `sample-app/` READMEs — don't let a new subproject go without it
