FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg git \
    chromium fonts-liberation libnss3 libatk-bridge2.0-0 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libasound2 libxss1 libgtk-3-0 && \
    rm -rf /var/lib/apt/lists/* && \
    git config --global user.email "x@x" && \
    git config --global user.name "x"

# Install opencode and chrome-devtools-mcp globally
RUN npm install -g opencode-ai@latest chrome-devtools-mcp@latest

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY src/ src/

# chrome-devtools-mcp will use CHROMIUM_PATH if set, or auto-detect chromium
ENV CHROMIUM_PATH=/usr/bin/chromium

EXPOSE 4020
CMD ["node", "src/index.js"]
