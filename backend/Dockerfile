FROM node:24-alpine

RUN apk add --no-cache \
    ca-certificates \
    python3 \
    make \
    g++

WORKDIR /app

# backend/ and frontend/ share one npm workspace rooted at the repo root
# (see /package.json) — build context must be the repo root, not backend/,
# so this can see the root package-lock.json. --workspace scopes the
# install to just this package's dependencies (plus shared root deps).
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --omit=dev --workspace=backend

COPY backend/src ./backend/src

WORKDIR /app/backend
EXPOSE 4010
CMD ["node", "src/index.js"]
