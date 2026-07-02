FROM node:24-alpine

RUN apk add --no-cache \
    ca-certificates \
    python3 \
    make \
    g++

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --legacy-peer-deps
COPY src ./src

EXPOSE 4010
CMD ["node", "src/index.js"]
