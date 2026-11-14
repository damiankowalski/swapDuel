# Roadmap

One package = one branch = one pull request. Sizes: **S** (a day or less), **M** (a few days), **L** (a week or more).
Merge and release only after the owner approves. Versions are tagged at the end of a package.

## Done

- **v0.1.0** (Aug 2026): PoC in one `index.html` - second-person view, bot training, P2P online through PeerJS.

## Next

### P0 - Bootstrap, reconnaissance, security · S-M · no release · *in review*

Agent contract (`AGENTS.md`), docs (`STATUS`, `ROADMAP`, `DECISIONS`, `NETWORKING`, `SECURITY`, `DEPLOYMENT`),
cross-platform hygiene, server reconnaissance and security assessment (kept in the private infrastructure repository).

**Done when:** both P0 pull requests (this repository and the infrastructure one) are approved and merged.

### P1 - Restructure · M · v0.2.0 · *in review*

- `client/` + `shared/`, Vite + TypeScript, Three.js from npm; `npm run build` gives one `dist/index.html`.
- Game moved 1:1: same arena, movement, timings and bot. Simulation (movement, collisions, hit raycast, bot) moves to
  `shared/`, without Three.js.
- UI and comments translated to English.
- Tests for `shared/` (`node:test`): collision resolution, movement, hit raycast, bot stays inside the arena;
  `npm run sim` runs a headless bot-vs-bot match.
- CI on every pull request: `npm ci`, `typecheck`, `test`, `build`, `npm audit --omit=dev`; Dependabot for npm.
- `.nvmrc`, `engines`, lockfile committed.
- **Keeps `main` playable on GitHub Pages:** Pages switches from "serve `main`" to a GitHub Actions deployment of
  `dist/` (moving `index.html` would otherwise break the live page). The P2P online mode stays as it is until P2,
  with PeerJS from npm (ADR-008).

**Done when:** offline and bot mode behave as in v0.1.0; the build is a single `index.html`; CI is green.

Built as planned; on top: P2P message validation and the room-code fix (`STATUS.md`). `npm run sim` has no
simulated lag yet; the lag simulator belongs to the network layer and arrives in P2.

### P2 - Server, locally · M-L · v0.3.0 · *in review*

- `server/`: Node + `ws`, serves `dist/`, WebSocket `/ws`, `GET /status`; configuration by environment variables
  (`HOST`, `PORT`, `MAX_ROOMS=1`, `ALLOWED_ORIGIN`, `CLIENT_IP_HEADER`, timeouts).
- Rooms with codes and the limit, timeouts, authoritative movement and hits at 30 Hz, protocol version in the
  handshake, schema validation, message and connection limits, heartbeat.
- Client: prediction and reconciliation, opponent interpolation (about 100 ms buffer), camera smoothing, lag simulator
  (ping, jitter, loss) in dev builds, readable "server busy" state in the menu. PeerJS removed.
- Tests: validation (bad and unknown messages close the socket), limits (third tab gets `busy`, rate limit, payload
  size), timeouts, server-side hit detection, a headless two-client match with simulated lag; camera jitter metric
  under 150 ms + jitter stays within the threshold in `NETWORKING.md`.

**Done when:** two tabs play through localhost at 150 ms + jitter and the camera does not shake; a third tab gets
"busy"; all tests green.

Built as planned, with three scope changes (ADR-012): no `ready` step, no reconnect yet, and the camera criterion
is "smooth with rare bridged starvations" (thresholds and measurements in `NETWORKING.md` §12).

### P3 - Deployment · S-M · v0.4.0

- `deploy/`: container image (non-root, read-only), compose file with an outbound tunnel connector, hardening as in
  `SECURITY.md`; image built and published by GitHub Actions on a tag (ADR-010); invite-only access gate (ADR-009).
- Runbook that the owner runs, including isolation checks and rollback; a matching pull request in the private
  infrastructure repository (folder on the server, docs).
- Security checklist from `SECURITY.md` ticked off; GitHub Pages switched off or turned into a redirect.

**Done when:** the owner deploys by the runbook; a match home Wi-Fi <-> mobile LTE works; the checklist is complete.

## Later

### P4+ - Gameplay · sizes later

Respawn with brief invulnerability, sound, mouse aim (pointer lock, pitch), round/score rules, bot that fights back,
reconnect into a running match (ADR-012), lag compensation, a per-IP room cool-down before opening the game to the
public. Scope decided after P3.

## Decisions taken in P0

All accepted by the owner on 2026-11-14.

| # | Question | Decision | Record |
| --- | --- | --- | --- |
| O1 | P1: keep the P2P online mode until P2 (PeerJS from npm, temporary dependency) or drop it in P1? | Keep it until P2 | ADR-008 |
| O2 | Put an access gate (invited players only) in front of the game for P3? | Yes for P3 and the first tests; public later as its own decision | ADR-009 |
| O3 | Container image from GitHub Actions on a tag (public registry) instead of building on the server | Yes | ADR-010 |
