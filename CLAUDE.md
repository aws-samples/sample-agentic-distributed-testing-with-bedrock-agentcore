# Agentic Test Runner — Agent Instructions

## Repository

Source repo for the **Agentic Test Runner** — an AI-powered parallel browser testing tool. The core focus is **AWS AgentCore Runtime + AgentCore Browser** orchestration using OpenCode as the agent framework.

Structure:
- `backend/` — Node.js + Express orchestrator (port 4010); routes test execution to the appropriate agent runtime, streams screenshots via SSE, pushes results to frontend via WebSocket, uploads evidence snapshots to S3
- `frontend/` — React + Vite UI served by nginx (port 5175); three pages — Editor (author/generate test cases), Runner (execute + watch live), Analysis (past runs + evidence screenshots)
- `agent-runtime-local/` — Agent runtime for local mode: OpenCode + chrome-devtools-mcp + local Chromium (port 4020)
- `agent-runtime-agentcore/` — Agent runtime for agentcore mode: OpenCode + chrome-devtools-mcp + AgentCore Browser; deployed to AWS via CDK in `agentcore/`
- `sample-app/` — CardDemo banking app (Spring Boot + React); the application under test, not part of the test runner stack
- `docker-compose.yml` — Runs backend + frontend + agent-runtime-local (profile: local)
- `terraform/` — Mode 2 (prod) deployment: EKS (Fargate) + ALB + CloudFront + ECR for the testrunner and sample-app stacks; see `terraform/README.md`
- `deploy-dev.sh` / `deploy-prod.sh` — automate Mode 1 (dev, local Docker Compose) and Mode 2 (prod, Terraform/EKS) respectively; see the root `README.md`'s Deployment Modes section

The frontend, backend, and sample-app are **intentionally simple Docker deployments**. The architectural interest is in the agent runtime layer.

## Agent Modes

Both modes use OpenCode as the agent framework. The only difference is how Chrome is provisioned:

- `AGENT_MODE=local` → `agent-runtime-local/`: OpenCode + local Chromium managed via CDP
- `AGENT_MODE=agentcore` → AWS AgentCore Runtime running `agent-runtime-agentcore/`: OpenCode + AgentCore Browser (managed Chrome)

Both the Bedrock model and the two AWS regions (Bedrock inference region, AgentCore Runtime/Browser region) are runtime-configurable from the frontend's Settings modal — see `backend/src/state/store.js` for the full config surface and `README.md` for the environment variable defaults.

## Safety

- Never commit secrets, tokens, or credentials (AWS account IDs, ARNs with real account numbers, API keys, live infrastructure identifiers)
- Never run `git commit` or `git push` unless the user explicitly tells you to do so in that moment
- If you add a commit, include `Co-Authored-By: Claude <noreply@anthropic.com>` in the commit message
- This repo is sample code, MIT-0 licensed (see `LICENSE`), for non-production usage — every new package/subproject should declare `"license": "MIT-0"` (or the Maven `<licenses>` equivalent) and, if it touches anything that reads as sensitive (auth flows, seeded "PII"-shaped data like `sample-app`'s CardDemo records, demo credentials), carry the same "sample code, non-production, work with security/legal before deployment" disclaimer already in the root and `sample-app/` READMEs — don't let a new subproject go without it
