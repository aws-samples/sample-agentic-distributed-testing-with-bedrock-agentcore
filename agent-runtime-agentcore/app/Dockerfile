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
CMD ["node", "src/index.js"]
