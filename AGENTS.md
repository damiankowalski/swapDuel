# AGENTS.md - working contract for coding agents

Read this file before any work in this repository. `CLAUDE.md` only imports it. When a prompt and this file
disagree, say so before building anything large.

## The game

**Swap Duel** is an experimental *second-person shooter* in the browser. You steer your own fighter, but the screen
shows the arena **through your opponent's eyes**. To hit, you learn to aim "backwards": the opponent stands at the centre
of the screen (the point they look from), so you throw your snowball's arc towards the centre.

- 1v1 on a square arena (20 x 20 m) with one indestructible crate in the middle.
- Controls: `W A S D` move, `<-` `->` turn, `Space` throw a snowball, `V` toggle view (opponent's eyes <-> own).
- Snowballs fly in an arc (about 18 m); 5 at the start, one more every 10 s, no cap. A dashed arc and the reticle
  show where the next one lands.
- A match is first to 10 points, after a 3-2-1 countdown; then a rematch. 1.5 s of spawn protection after a hit.
- Modes: **online** (two players, a room code) and **training** against a bot that throws back (offline).
- Current state, bugs and next step: [`docs/STATUS.md`](docs/STATUS.md).

## Communication

- The owner (Damian) writes to the agent **in Polish**; answer him in Polish.
- **Everything in the repository is in English**: code, comments, docs, commit messages, pull requests and in-game
  text.

## Repository map

Today (P4a, v0.6.0):

```
swapduel/
├─ client/                Vite entry: index.html (markup + CSS), src/main.ts (rendering, input, HUD, training),
│                         src/net.ts (online session: WebSocket, prediction, interpolation, dev lag simulator)
├─ server/                game server, TypeScript run directly by Node: app.ts (HTTP + WebSocket, limits),
│                         rooms.ts (codes, MAX_ROOMS, timeouts), match.ts (authoritative 30 Hz simulation),
│                         config.ts (environment), limits.ts, main.ts (entry); *.test.ts next to them
├─ shared/                pure TypeScript: game rules (constants, arena, player, bot, snowballs, room codes), the
│                         protocol, and the netcode (netsim, prediction, interpolation, One Euro filter, lag)
├─ tools/                 sim.ts (CLI), netplay.ts (headless network match for the camera metrics)
├─ docs/                  STATUS, ROADMAP, DECISIONS, NETWORKING, SECURITY, DEPLOYMENT
├─ .github/               CI (typecheck, tests, sim, build, audit, image), release image, Dependabot
├─ vite.config.ts         builds client/ to dist/index.html (one self-contained file)
├─ tsconfig*.json         base options; shared guard (no DOM, no Node); client (DOM); Node side (tests, tools)
└─ AGENTS.md, CLAUDE.md, README.md, LICENSE
```

`deploy/` holds the container image (`Dockerfile`), the compose file and the `.env` template (P3,
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)); `.github/workflows/release.yml` publishes the image on a `vX.Y.Z` tag.

`shared/` must never import Three.js, DOM or Node APIs (`tsconfig.shared.json` enforces it): the client, the
server and headless tests all run it. Only `client/` may use Three.js.

## Toolchain

- **Node.js 26 LTS** (Active LTS since October 2026, supported until April 2029). Node 26 runs `.ts` files directly
  (type stripping is stable and needs no flag), so the server has no build step. Only *erasable* TypeScript is
  allowed: no `enum`, no `namespace`, no constructor parameter properties; `tsconfig.json` sets
  `erasableSyntaxOnly`, `verbatimModuleSyntax` and `allowImportingTsExtensions`, and relative imports name the `.ts`
  extension. Node ignores `tsconfig.json` (no path aliases).
- `.nvmrc` says `26`; `package.json` has `"engines": { "node": ">=26 <27" }`. TypeScript 7 (the native compiler)
  does the type checking; Vite does the client build; Node runs tests and tools from the `.ts` sources.
- Every task runs through `npm run …`; no `.sh`, `.bat` or `.ps1` scripts. The same commands work on macOS and
  Windows.
- Dependencies are minimal: `three`, `ws`, `vite`, `vite-plugin-singlefile`, `typescript` and type packages. Any
  other library needs an entry in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Commands

Keep these names stable; CI runs the same ones.

| Command | What it does |
| --- | --- |
| `npm ci` | Install exactly what the lockfile says |
| `npm run dev` | Vite dev server on `http://127.0.0.1:5173`; proxies `/ws` and `/status` to `npm run server` |
| `npm run build` | Build the client to `dist/index.html` (one self-contained file) |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | `tsc` (no emit) for shared, client and the Node side |
| `npm test` | `node --test` on `shared/`, `server/` and `tools/` tests (unit, socket integration, camera metrics) |
| `npm run sim -- --seconds 300 --seed 1` | Headless bot-vs-bot match; fails if a fighter ever leaves the valid area |
| `npm run sim -- --net --lag 150 --jitter 30 --stall 0.02` | Headless network match: camera smoothness vs v0.1.0 |
| `npm run server` | Game server on `http://127.0.0.1:8080` (serves `dist/`, `/ws`, `/status`); env vars in `server/config.ts` |
| `npm run play` | `build` + `server`: open two tabs at `http://127.0.0.1:8080` and play |

Simulated network in the browser (dev builds only): run `npm run server` and `npm run dev`, then open
`http://127.0.0.1:5173/?lag=150&jitter=30&stall=0.02` (one-way values; `?debug` shows the net overlay without lag).

## Standing rules

1. **GitHub is the source of truth.** Start with `git pull`, finish with a push. `main` always runs.
2. **One roadmap package = one branch = one pull request.** Branches `feat/…` and `chore/…` (`fix/…`, `docs/…` for
   small changes). Merge (squash) and release only after Damian approves.
3. **Release** = tag `vX.Y.Z` and `gh release create` with the built `dist/index.html` attached. The agent never
   merges, tags or releases.
4. **Every change to game or network behaviour has a test.**
5. **The agent has no access to the server** and changes nothing on the VPS or in DNS. It prepares commands and
   runbooks; Damian runs them. Server-specific details live in a private infrastructure repository, never here.
6. **This repository is public:** no secrets and no details of the owner's infrastructure (addresses, other services,
   firewall rules, account names). Generic deployment design is fine.
7. **Secure by default:** every network input is untrusted and validated; the game process runs with minimal
   privileges.
8. **English in the repository; Polish with Damian.**
9. **Pragmatism over over-engineering.** Every new framework or library is justified in `docs/DECISIONS.md`.
10. **Docs move with the code:** `STATUS`, `ROADMAP`, `DECISIONS`, `NETWORKING` and `SECURITY` are updated in the same
    pull request as the change they describe. They are synced into Damian's claude.ai project and used for planning.
11. **Ask first** when something is unclear or contradicts the prompt, before building anything large.

## Which file to update when

| File | Contents | Update when |
| --- | --- | --- |
| `AGENTS.md` | Repo map, commands, rules, workflow | Structure, commands or rules change |
| `docs/STATUS.md` | Version, what works, what does not, bugs, next step (one screen) | **Every pull request** |
| `docs/ROADMAP.md` | Done / Next / Later packages | A package ends or its scope changes |
| `docs/DECISIONS.md` | ADRs: date, decision, alternatives, reason | Every architectural decision |
| `docs/NETWORKING.md` | Network architecture, protocol, limits | Netcode changes |
| `docs/SECURITY.md` | Threat model and the game's protections (generic) | Server or deployment changes |
| `docs/DEPLOYMENT.md` | How to deploy (no server details) | Deployment changes |

## Git workflow

- Before work: `git switch main && git pull`, then `git switch -c feat/<name>`. Check `git branch --show-current`
  before committing.
- Small, logical commits; imperative English subject line; the body says why.
- Push the branch, open a pull request with `gh pr create`: what and why, how it was tested, what Damian should check,
  and what could not be run in the agent's environment.
- Never push to `main`, never force-push, never rewrite history. Undo = `git revert` in a new pull request.
