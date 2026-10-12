# Agentic Distributed Testing with Bedrock AgentCore

## Screenshots

**Runner — Agentic Distributed Testing in action: 8 parallel browser sessions, each driven by its own agent**

![Runner page showing 8 parallel browser sessions](assets/screencap_1.png)

**Analysis — AI verdict, evidence snapshots, and agent reasoning log for a single test case**

![Analysis page showing AI verdict, evidence snapshots, and agent log](assets/screencap_2.png)

## The Problem

UI test scripts are brittle: Selenium/Playwright scripts rely on hard-coded selectors, so a relocated button or renamed field breaks dozens of tests at once, and teams end up spending more effort maintaining scripts than writing new coverage.

## Agentic Testing

Replace selector-based scripts with AI agents that read the live page and reason about each step of a plain-English test case — a relocated button or renamed field doesn't break the test the way it breaks a scripted one. This repo demonstrates two pieces of that approach:

- **Adaptive execution** — natural-language test cases fanned out across many parallel AI agents (OpenCode on Amazon Bedrock — Anthropic Claude, OpenAI GPT-OSS, and other models all work), each driving its own isolated **AgentCore Browser** session. No DOM selectors, no scripted steps. The core focus of this project is the **AWS AgentCore Runtime + AgentCore Browser** orchestration layer; the frontend, backend, and sample app are intentionally simple Docker deployments built to support that demo.
- **Spec generation** — generate a full test suite from a plain-language app description via a Bedrock planner + per-feature worker agent loop.

Every test case run also captures S3 evidence screenshots for human review on the Analysis page — a first step toward automated failure remediation, not yet a closed loop.

## Repository Structure

```
.
├── package.json                 # npm workspace root — backend/ + frontend/ share one
│                                 # node_modules; `npm run dev` starts both
├── backend/                     # Node.js + Express orchestrator (port 4010)
├── frontend/                    # React + Vite UI (dev: :5173; prod build served by nginx :5175)
├── agent-runtime-local/         # Agent runtime: OpenCode + local Chromium (port 4020)
├── agent-runtime-agentcore/     # Agent runtime: OpenCode + AgentCore Browser (AWS deploy)
│   ├── app/                     # Dockerfile + package.json + src/ — the deployable code
│   │                            # (kept separate from agentcore/ below: the CLI zips
│   │                            # codeLocation as a raw asset with no filtering, so CDK
│   │                            # tooling can never share a directory with it)
│   └── agentcore/               # CDK infra for deploying to AgentCore Runtime
├── sample-app/                  # CardDemo banking app — the application under test
│   ├── backend/                 # Spring Boot API (port 8021)
│   └── frontend/                # React + Vite, proxied through nginx (port 8020)
├── init-sample-app.sh           # start/stop/destroy the sample app (Docker)
├── init-local-runtime.sh        # start/stop/destroy agent-runtime-local (Docker)
├── init-agentcore-runtime.sh    # deploy/destroy the AgentCore Runtime (AWS); prompts for region
└── docker-compose.yml            # backend + frontend (built from repo-root
                                   # context — see backend/Dockerfile) + agent-runtime-local
                                   # (started by init-local-runtime.sh / npm run build); run
                                   # backend/frontend yourself with `npm run dev` for local
                                   # iteration instead
```

## Architecture

The orchestrator backend implements Agentic Distributed Testing across two agent modes, both using OpenCode as the agent framework:

### Local mode (`AGENT_MODE=local`)

```
Browser (you)
     |
     v
frontend :5175  ──/api/*──>  backend :4010  ──HTTP──>  agent-runtime-local :4020
                                  |                          |
                              WebSocket                 OpenCode CLI
                           (live results)           chrome-devtools-mcp
                                  |                    local Chromium
                                  v
                            S3 (evidence
                             snapshots)
```

### AgentCore mode (`AGENT_MODE=agentcore`)

```
Browser (you)
     |
     v
frontend :5175  ──/api/*──>  backend :4010  ──InvokeAgentRuntime──>  AgentCore Runtime (AWS)
                                  |                                         |
                              WebSocket                               OpenCode CLI
                           (live results)                          chrome-devtools-mcp
                                  |                              AgentCore Browser (managed Chrome)
                                  v
                            S3 (evidence
                             snapshots)
```

In both modes:
- OpenCode drives the agent loop with `assert_pass` / `assert_fail` MCP tools for verdict
- Screenshots stream back via SSE → WebSocket to the frontend in real time
- Test cases are plain English; no DOM selectors
- Non-blank screenshot frames are sampled per test case and uploaded to S3 as evidence, viewable from the Analysis page

## User Interface

The frontend is a single-page app with three views, reachable from the top nav:

- **Editor** — author test cases by hand (feature → test case written as a standard Gherkin scenario, Given / When / Then / And — see "AI-enhanced BDD" below), import/export as YAML, or generate a whole suite from a natural-language spec (see "Agentic test-suite generation" under Features below).
- **AI-enhanced BDD** — test cases use Given / When / Then in plain language and may be deliberately ambiguous: they don't need to map to predefined step definitions, because the agent works out the concrete UI interactions itself and judges outcomes by meaning. The editor has two tabs: **Editor** (a friendly form, one row per Given / When / Then / And step) and **Gherkin** (the raw scenario text, with live error checking). Each test case has an **Enhance by AI** button that rewrites it into this style and shows original vs. enhanced Gherkin side by side; nothing changes until you click Save. Each **Feature** is a group of scenarios and has an optional **Background**: shared setup that applies before every scenario in it (so it isn't repeated in each test case), and which the agent works through at run time. Test case ids are plain and suite-wide (`TC001`, `TC002`, …), not tied to a feature.

Older data upgrades itself: on first start the backend renames the old module tables to features, renumbers `MD001-TC001`-style ids to `TC001`, …, re-keys saved results, and writes a copy of the database next to it (`data.pre-feature-rename-*.db`) first. YAML exported earlier (`modules:`, `MD…` ids, `preconditions` / `steps` / `expectedResult`) still imports; any case without a current id gets one.
- **Runner** — pick features/test cases and execute them; watch each feature's browser session live via streamed screenshots, with pass/fail status updating in real time over WebSocket.
- **Analysis** — browse past runs, drill into a run's per-feature/per-test-case results, and view the S3 evidence screenshots captured for each test case.

## Deployment

Everything runs on a single EC2 instance (or your own machine) — no load balancer, CDN, or Kubernetes. The AgentCore Runtime is the only piece deployed as separate AWS infrastructure. There is no dev/prod split:

- **Local iteration:** `npm run dev` — backend :4010 + frontend :5173 (Vite, hot reload).
- **Run in Docker on the machine:** `npm run build` — builds the backend + frontend images and starts them (`docker compose up -d --build`; frontend served by nginx on :5175). `npm run stop` brings them down.

### Setup

The platform orchestrates browser agents against a target app. Three scripts set up what it talks to — run only the ones you need; each is independent:

| Script | Sets up | Needed when |
|---|---|---|
| `./init-sample-app.sh` | CardDemo sample app (Docker, :8020/:8021) — the app under test | Whenever you test against the bundled sample app |
| `./init-local-runtime.sh` | `agent-runtime-local` (Docker, :4020) | Settings → Agent Mode = Local Runtime |
| `./init-agentcore-runtime.sh` | AgentCore Runtime in AWS (real resources, costs money). Asks for the AWS region (default `us-east-1`; set `AGENTCORE_REGION` to skip the prompt), then writes the region and `AGENTCORE_RUNTIME_ARN` into `.env` **and** `backend/src/state/config.json` | Settings → Agent Mode = AgentCore Runtime; re-run after changing `agent-runtime-agentcore/app/` |

Both runtimes can exist at once; pick which one runs the agents in the platform's Settings → Agent Mode (`AGENT_MODE` in `.env` is only the initial default). The AgentCore region is decided by `init-agentcore-runtime.sh` and is shown read-only in Settings. Restart the backend after running it — it only reads `.env` / `config.json` at start-up. Connect does not deploy anything: the AgentCore Runtime must exist first. Each script has `--destroy`, which removes everything that script created (containers, images and volumes for the Docker ones; the CloudFormation stack for AgentCore). The two Docker scripts also have `--down`, which only stops containers.

```bash
# Copy the example env and adjust as needed
cp .env.example .env

# Install once (root workspace covers both backend/ and frontend/ — see /package.json)
npm install

./init-sample-app.sh
./init-local-runtime.sh        # optional — Local Runtime mode
./init-agentcore-runtime.sh    # optional — AgentCore Runtime mode (deploys to AWS)

# In your own terminal — running this directly (not backgrounded by a
# script) means your editor's port auto-forwarding (e.g. VS Code, which
# watches a terminal's own output) picks up both ports correctly:
npm run dev   # backend :4010 + frontend :5173 (Vite dev server, hot reload)
# Or run them separately in their own terminals: npm run dev:backend / npm run dev:frontend
# Target URL already defaults to the sample app at http://localhost:8020,
# so no Settings change needed.

# Stop the Docker pieces when you're done (an AgentCore Runtime in AWS keeps
# running — see Cleaning Up below); stop the platform yourself (Ctrl-C):
./init-sample-app.sh --down       # or --destroy to also remove images and the DB volume
./init-local-runtime.sh --down    # or --destroy
```

`backend/` and `frontend/` share one npm workspace rooted at the repo root (`/package.json`) — a single `npm install` there covers both, with one shared `node_modules`. State persists to SQLite (`backend/src/state/data.db`) and S3 for evidence snapshots — no ALB, no CloudFront, no auth in front of the UI. Restrict access with the instance's security group.

### Cleaning Up

Every script has `--destroy`, which removes what that script created:

```bash
./init-sample-app.sh --destroy          # containers, network, DB volume, images
./init-local-runtime.sh --destroy       # container and image
./init-agentcore-runtime.sh --destroy   # CloudFormation stack + runtime in AWS; clears the ARN
```

`--down` (Docker scripts only) just stops containers and keeps images and data. The AgentCore Runtime in AWS, and its cost, keeps running until you `--destroy` it. That runs the remove-then-redeploy flow documented for the `agentcore` CLI (remove the runtime from `agent-runtime-agentcore/agentcore/agentcore.json`, `agentcore deploy` to destroy the underlying CDK stack, then restore `agentcore.json` so the next `./init-agentcore-runtime.sh` has something to redeploy). It is safe to run if nothing was deployed. CloudWatch log groups and any ECR images are not deleted.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_URL` | `http://localhost:8020` | Application under test |
| `AGENT_MODE` | `agentcore` | `agentcore` or `local`. Only the initial default — switch at runtime in Settings → Agent Mode. |
| `BEDROCK_MODEL` | `global.anthropic.claude-sonnet-5` | Bedrock model ID used for agent inference, test generation, and health checks |
| `BEDROCK_REGION` | `us-east-1` | AWS region for Bedrock model inference |
| `BROWSER_REGION` | `ap-southeast-1` | AWS region for AgentCore Runtime + AgentCore Browser (defaults to the EC2 host's own region when running on EC2, if unset). Set by `init-agentcore-runtime.sh` |
| `AGENTCORE_RUNTIME_ARN` | — | Required for `agentcore` mode; the ARN of your deployed AgentCore Runtime. Filled in automatically by `init-agentcore-runtime.sh` |
| `S3_SNAPSHOT_BUCKET` | — | S3 bucket for evidence snapshots shown on the Analysis page. Leave unset to disable snapshot capture entirely |
| `S3_SNAPSHOT_REGION` | `ap-southeast-1` | Region of the snapshot bucket |
| `PORT` | `4010` | Backend HTTP port (set by docker-compose; rarely overridden) |
| `LOCAL_RUNTIME_URL` | `http://localhost:4020` | Where the backend reaches `agent-runtime-local` (local mode only) |

Most of these can also be changed at runtime from the frontend's Settings modal (model, agent mode, Bedrock region, target URL, auth; the AgentCore region is read-only there) — the backend persists your choices to `backend/src/state/config.json` so they survive a restart. Env vars only supply the initial defaults.

Test cases (Editor page) and the run archive (Analysis page) are persisted to a SQLite database at `backend/src/state/data.db` (schema in `backend/src/state/db.js`), so edits and past runs survive a backend restart. Docker Compose mounts a named volume (`backend-state`) over `backend/src/state/` so this — along with `config.json`/`testResults.json` — also survives a container rebuild, not just a restart.

If you enable S3 snapshots, the container's IAM role needs `s3:PutObject` and `s3:GetObject` on the bucket. A lifecycle policy that expires objects after ~30 days is recommended. Object keys follow `runs/<runId>/<tcId>/<seq>.png`.

## Features

- **Multi-page UI** — dedicated Editor, Runner, and Analysis pages instead of one crowded screen (see "User Interface" above).
- **Agentic test-suite generation** — paste an application spec (and optional feature hints) into the Editor's Generate flow; a Bedrock "planner" call decides on 3-10 features, then a per-feature "worker" call streams detailed test cases (happy path, edge cases, negative tests) for each feature in turn. See `backend/src/routes/generate.js`.
- **Evidence snapshots** — screenshots captured during each test case run are uploaded to S3 and shown alongside the result on the Analysis page, so a FAIL verdict comes with visual proof. See `backend/src/services/snapshots.js`.
- **Multi-model support** — the Settings modal lets you pick from a curated list of Bedrock models across providers (Anthropic Claude, OpenAI GPT-OSS, Moonshot Kimi, MiniMax, Alibaba Qwen, Z.ai GLM), or enter any custom model ID. A "Check" button runs a live health-check call against the selected model/region.
- **Independently configurable regions** — Bedrock model inference and AgentCore Runtime/Browser can each point at a different AWS region, changeable from Settings without a restart.

## Sample App

`sample-app/` is a CardDemo banking application (Spring Boot + React) used as the target for test cases. It has no relation to the test runner's own stack — it exists purely as a realistic app to test against. See `sample-app/README.md` for details on what it implements and how it maps to the original COBOL/CICS/VSAM mainframe application.

```bash
cd sample-app
docker compose up --build
# Frontend: http://localhost:8020
# Backend API: http://localhost:8021
```

## AgentCore Deployment

`init-agentcore-runtime.sh` automates this (see Deployment above) — the manual equivalent:

```bash
cd agent-runtime-agentcore/agentcore/cdk && npm install && cd ..
cd .. && npx agentcore deploy   # must run from agent-runtime-agentcore/, not agentcore/
```

The CDK stack packages `agent-runtime-agentcore/app/` (Dockerfile + package.json + src/ — see `agentcore.json`'s `codeLocation`) for CodeBuild to build as a container, pushes it to ECR, and provisions the AgentCore Runtime endpoint. Update `AGENTCORE_RUNTIME_ARN` in your `.env` with the resulting ARN, then select AgentCore in Settings.

**Observability:** the runtime container is instrumented with the AWS Distro for OpenTelemetry (see `agent-runtime-agentcore/app/Dockerfile`), so spans reach CloudWatch (GenAI Observability / Transaction Search) in addition to the runtime logs. "Tracing enabled" on the runtime only sets up delivery; the spans come from this instrumentation, so redeploy after changing it. CloudWatch Transaction Search must be enabled in the account.

## Security & Compliance

This is sample code, for non-production usage. You should work with your security and legal teams to meet your organizational security, regulatory, and compliance requirements before deployment. In particular: the bundled CardDemo sample app and its `USER0001` / `PASSWORD` demo credentials (`sample-app/README.md`) exist purely to give the test runner something to exercise — do not reuse them, or this repo's Docker deployment patterns as-is, for anything handling real user data.

## License

Licensed under [MIT-0](LICENSE) (MIT No Attribution) — see the `LICENSE` file at the repo root. Every package (the workspace root, `backend/`, `frontend/`, `agent-runtime-local/`, `agent-runtime-agentcore/app/`, `sample-app/frontend/`) declares the same license in its `package.json`.
