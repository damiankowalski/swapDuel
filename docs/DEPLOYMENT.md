# Deployment

How the game is released and deployed. Deliberately generic: this repository is public, so the details of the
server it runs on (folders, accounts, the tunnel provider's settings, the exact runbook) live in the owner's private
infrastructure repository. The agent never deploys (ADR-006): it prepares the files, the owner runs them.

## 1. Target

- Public address: `https://swapduel.damiankowalski.pl`: page, WebSocket `/ws` and `GET /status` on one origin
  (ADR-004). The first deployment is behind an invite-only access gate at the edge (ADR-009).
- One container image with the built client and the server, plus an outbound tunnel connector; Docker Compose; no
  published ports (ADR-007, `SECURITY.md` §4).

## 2. Files

| File | What it is |
| --- | --- |
| `deploy/Dockerfile` | Two stages: builds `dist/` with Vite, then a slim Node 26 runtime with `server/`, `shared/`, `dist/` and the production dependency `ws`; npm removed; runs as user `node` (uid 1000); a local health check on `GET /status` |
| `deploy/compose.yaml` | Project `swapduel`: `server` (only on the internal network `game`) and `cloudflared` (on `game` and `egress`); both read-only, all capabilities dropped, `no-new-privileges`, memory / CPU / process limits; log rotation |
| `deploy/env.example` | Template of `.env`: `SWAPDUEL_VERSION` and `TUNNEL_TOKEN` (the only secret) |
| `.dockerignore` | Keeps the build context to the code |
| `.github/workflows/ci.yml` (job `image`) | On every pull request: builds the image, validates the compose file, starts the image with the production hardening and checks `/status`, the CSP header, a 404, uid 1000, no npm, a read-only file system |
| `.github/workflows/release.yml` | On a tag `vX.Y.Z`: checks it matches `package.json`, builds and pushes `ghcr.io/damiankowalski/swapduel:X.Y.Z` |

Server settings are environment variables (`server/config.ts`, `NETWORKING.md` §2). The compose file sets
`HOST=0.0.0.0` (inside the container, on the internal network only), `PORT=8080`, `MAX_ROOMS=1`,
`ALLOWED_ORIGINS=https://swapduel.damiankowalski.pl` and `CLIENT_IP_HEADER=cf-connecting-ip` (the header the edge sets).

## 3. Releasing a version

1. Every package is merged into `main` with CI green; `package.json` has the new version.
2. The owner tags and creates the release from an up-to-date `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`,
   then `npm ci && npm run build` and `gh release create vX.Y.Z dist/index.html --title vX.Y.Z --generate-notes`.
3. The "Release image" workflow publishes `ghcr.io/damiankowalski/swapduel:X.Y.Z`. The first time only: in the
   package settings on GitHub, set the package's visibility to **public** (the repository is public), so the server
   can pull it without a registry login.

## 4. Deploying (outline)

The step-by-step runbook, with the server's paths, the tunnel and access gate settings and the checks, is in the
private infrastructure repository. In outline:

1. **Once:** a folder on the server for the compose project (root only), the repository cloned on the server, a
   tunnel whose public host name routes to `http://server:8080`, the access gate, `.env` from `deploy/env.example`.
2. **Each version:** pull the repository on the server (for `deploy/compose.yaml`), copy the compose file to the
   project folder, set `SWAPDUEL_VERSION`, then `docker compose pull` and `docker compose up -d`.
3. **Verify:** `docker compose ps` shows both containers running and the server healthy; `GET /status` through the
   public address; the isolation checks and the rest of `SECURITY.md` §6; a match between two networks (home
   Wi-Fi and mobile data).
4. **Rollback:** set `SWAPDUEL_VERSION` back to the previous version and `docker compose up -d`. No data to migrate:
   the game keeps nothing.
5. **After the first deployment:** GitHub Pages is switched off (or replaced by a redirect page).

## 5. Local equivalent

`npm run play` (build + server) runs the same server on `http://127.0.0.1:8080`, which by default accepts the
local origins; two windows play against each other. The lag simulator works in dev builds (`AGENTS.md`, Commands).
With Docker installed, the image can be tried locally too:
`docker build -f deploy/Dockerfile -t swapduel . && docker run --rm -e HOST=0.0.0.0 -e ALLOWED_ORIGINS=http://127.0.0.1:8080 -p 127.0.0.1:8080:8080 swapduel`.
