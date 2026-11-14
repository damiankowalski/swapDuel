# Swap Duel game server image: the built client (dist/index.html) and the Node server, nothing else.
# Build from the repository root:  docker build -f deploy/Dockerfile -t swapduel .
# Runs as the non-root user "node"; the code is owned by root and read-only for that user.

# ---- Stage 1: build the client ----
FROM node:26.13.1-trixie-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:26.13.1-trixie-slim
LABEL org.opencontainers.image.source="https://github.com/damiankowalski/swapDuel" \
      org.opencontainers.image.description="Swap Duel game server" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime dependencies only (ws), then remove npm itself: the server never installs anything.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm
COPY shared ./shared
COPY server ./server
COPY --from=build /src/dist ./dist

USER node
EXPOSE 8080
# Local check only (the container has no route out in production): GET /status must answer.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/status').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server/main.ts"]
