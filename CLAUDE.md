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
