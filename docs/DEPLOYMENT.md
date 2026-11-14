# Deployment

Status: **draft** (P0). The real files arrive in `deploy/` in P3. This file contains no details of the server; the
owner keeps those in a private infrastructure repository. The agent never deploys (ADR-006): it prepares the files
and a runbook, the owner runs it.

## 1. Target

- Public address: `https://swapduel.damiankowalski.pl` - page, WebSocket `/ws` and `GET /status` on one origin
  (ADR-004).
- One container image with the built client and the server, plus an outbound tunnel connector; Docker Compose; no
  published ports (ADR-007, `SECURITY.md` §4).
- First deployment behind an invite-only access gate at the edge (ADR-009).

## 2. Release pipeline (P3)

1. A pull request is merged into `main` (CI green: typecheck, tests, build, audit).
2. The owner tags `vX.Y.Z` and creates the GitHub release.
3. GitHub Actions on the tag: builds the client (`npm run build`), builds the image, pushes it to the GitHub Container
   Registry as `ghcr.io/damiankowalski/swapduel:X.Y.Z` (never only `latest`), attaches `dist/index.html` to the
   release (archive copy; runs only bot mode when downloaded).

## 3. Image

- Multi-stage build: stage 1 installs dependencies with `npm ci` and builds `dist/`; stage 2 is a minimal Node 26
  runtime with only `server/`, `shared/`, production `node_modules` (`ws`) and `dist/`.
- Runs as a non-root user; no shell tools needed at runtime; `HEALTHCHECK` not used (the process has no outbound
  network; the runtime's restart policy covers crashes).
- Starts with `node server/main.ts`; reads its configuration from the environment.

## 4. Compose file (shape)

```yaml
name: swapduel
networks:
  game: { internal: true }   # game <-> connector only
  egress: {}                 # connector -> tunnel provider
services:
  server:      # the game; only on "game"; non-root, read-only, cap_drop ALL, no-new-privileges, limits
  connector:   # outbound tunnel; on "game" and "egress"; token from the server's .env
```

Environment of `server` (all variables: `server/config.ts`, `NETWORKING.md` §2): `HOST=0.0.0.0`, `PORT=8080`,
`MAX_ROOMS=1`, `ALLOWED_ORIGINS=https://swapduel.damiankowalski.pl`, `CLIENT_IP_HEADER` (the edge's client-IP
header). The compose file also uses `SWAPDUEL_VERSION` (image tag). The only secret, the tunnel token, is in an
environment file on the server, readable by root only, never in git.

## 5. Runbook outline (written in full in P3)

1. **Check first:** the server folder and its `.env` exist; the tunnel route points to the `server` service on port
   8080; no other process uses the names.
2. **Deploy:** `git pull` of the game repository on the server; set `SWAPDUEL_VERSION`; `docker compose pull`;
   `docker compose up -d`.
3. **Verify:** `GET /status` through the public address says `free`; a match from two devices on different networks
   (home Wi-Fi and mobile LTE); the security checklist in `SECURITY.md` §6.
4. **Rollback:** set `SWAPDUEL_VERSION` back to the previous tag; `docker compose up -d`. No data to migrate.
5. **Switch off GitHub Pages** (or leave a redirect page) after the first successful deployment.

## 6. Local equivalent

`npm run play` (build + server) runs the same server on `http://127.0.0.1:8080`, which by default accepts the
local origins; two tabs play against each other. The lag simulator works in dev builds (`AGENTS.md`, Commands).
