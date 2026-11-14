# AGENTS.md - working contract for coding agents

Read this file before any work in this repository. `CLAUDE.md` only imports it. When a prompt and this file
disagree, say so before building anything large.

## The game

**Swap Duel** is an experimental *second-person shooter* in the browser. You steer your own fighter, but the screen
shows the arena **through your opponent's eyes**. To hit, you learn to aim "backwards": the opponent is hit when your
projected reticle sits at the centre of the screen (the point they look from).

- 1v1 on a square arena (20 x 20 m) with one indestructible crate in the middle.
- Controls: `W A S D` move, `<-` `->` turn, `Space` fire (hold for a burst), `V` toggle view (opponent's eyes <-> own).
- Modes: **online** (two players, a room code) and **training** against a bot (offline).
- Current state, bugs and next step: [`docs/STATUS.md`](docs/STATUS.md).

## Communication

- The owner (Damian) writes to the agent **in Polish**; answer him in Polish.
- **Everything in the repository is in English**: code, comments, docs, commit messages, pull requests and in-game
  text.

## Repository map

Today (v0.1.0):

```
swapduel/
├─ index.html        the whole game: Three.js 0.160 + PeerJS 1.5.4 from a CDN, inline CSS and JS
├─ AGENTS.md         this contract; CLAUDE.md = "@AGENTS.md"
├─ docs/             STATUS, ROADMAP, DECISIONS, NETWORKING, SECURITY, DEPLOYMENT
└─ README.md, LICENSE
```

Target (built in P1-P3, see [`docs/ROADMAP.md`](docs/ROADMAP.md)):

```
swapduel/
├─ client/           Vite + TypeScript, Three.js from npm; build -> dist/index.html (single file)
├─ server/           Node + ws, TypeScript run directly by Node; serves dist/, WebSocket /ws, GET /status
├─ shared/           pure TypeScript, no Three.js: arena, movement, collisions, hit raycast, protocol + version
├─ docs/             as above
└─ deploy/           container image, compose file, runbook
```

`shared/` must never import Three.js, DOM or Node APIs: the client, the server and headless tests all run it.

## Toolchain

- **Node.js 26 LTS** (Active LTS since October 2026, supported until April 2029). Node 26 runs `.ts` files directly
  (type stripping is stable and needs no flag), so the server has no build step. Only *erasable* TypeScript is
  allowed: no `enum`, no `namespace`, no constructor parameter properties; `tsconfig.json` sets
  `erasableSyntaxOnly`, `verbatimModuleSyntax` and `allowImportingTsExtensions`, and relative imports name the `.ts`
  extension. Node ignores `tsconfig.json` (no path aliases).
- P1 adds `.nvmrc` (`26`) and `"engines": { "node": ">=26 <27" }` in `package.json`.
- Every task runs through `npm run …`; no `.sh`, `.bat` or `.ps1` scripts. The same commands work on macOS and
  Windows.
- Dependencies are minimal: `three`, `ws`, `vite`, `vite-plugin-singlefile`, `typescript` and type packages. Any
  other library needs an entry in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Commands

Today there is no tooling: open `index.html` in a desktop browser (it needs internet for the CDN).

From P1 on (planned names; keep them stable once they exist):

| Command | What it does |
| --- | --- |
| `npm ci` | Install exactly what the lockfile says |
| `npm run dev` | Vite dev server for the client (bot mode; online mode from P2 with the local server) |
| `npm run build` | Build the client to `dist/index.html` (one file) |
| `npm run typecheck` | `tsc --noEmit` for client, server and shared |
| `npm test` | `node --test` for `shared/` and `server/` |
| `npm run sim` | Headless simulation of a match (bot vs bot, optional simulated lag) |
| `npm run server` | Start the game server locally (serves `dist/`, `/ws`, `/status`) - from P2 |

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
