FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git && \
    rm -rf /var/lib/apt/lists/* && \
    git config --global user.email "x@x" && \
    git config --global user.name "x"

# Install opencode and chrome-devtools-mcp globally
RUN npm install -g opencode-ai@latest chrome-devtools-mcp@latest

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY src/ src/

ENV PORT=8080
EXPOSE 8080
# Observability: AgentCore's "Tracing Enabled" only sets up span delivery —
# spans must be emitted by the app. ADOT auto-instruments http/express/AWS SDK
# and exports to the X-Ray OTLP endpoint (SigV4, via the execution role), which
# lands in CloudWatch Transaction Search (aws/spans) and GenAI Observability.
# The endpoint is region-specific, so it is set at start-up from AWS_REGION.
# This app is an ES module, so --require alone emits no spans: the loader hook
# is what lets ADOT patch ESM imports (verified locally).
ENV AGENT_OBSERVABILITY_ENABLED=true \
    OTEL_RESOURCE_ATTRIBUTES=service.name=TestRunnerAgent \
    OTEL_TRACES_EXPORTER=otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_METRICS_EXPORTER=none \
    OTEL_LOGS_EXPORTER=none
CMD ["sh", "-c", "export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=${OTEL_EXPORTER_OTLP_TRACES_ENDPOINT:-https://xray.${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}.amazonaws.com/v1/traces}; exec node --require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register --experimental-loader=@opentelemetry/instrumentation/hook.mjs src/index.js"]
