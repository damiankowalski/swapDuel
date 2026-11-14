# Architecture decisions

Each record: date, status, decision, alternatives, reason. New decisions get the next number; a decision that
changes is superseded by a new record, not edited away.

---

## ADR-001 - Three.js in the browser, not the Penumbra engine

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** Keep Three.js in the browser as the engine.

**Alternatives.** The owner's own engine from another project (Penumbra: C++20 and Direct3D 12).

**Reason.** Penumbra runs only on Windows, cannot run in a browser and has no networking. The game must run on macOS,
Windows and in any browser, with online play. From that project we take only the way of working: an `AGENTS.md`
contract, a roadmap in packages (one package = one pull request), mandatory tests and a headless simulation.

---

## ADR-002 - Authoritative WebSocket server instead of P2P with TURN

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** Replace PeerJS (WebRTC P2P) with an authoritative game server reached over WebSocket (`wss://`, port
443). The server simulates movement and decides hits.

**Alternatives.** (a) Keep P2P and add a TURN server (e.g. coturn) for double NAT / CGNAT. (b) A hosted relay service.

**Reason.** Both clients connect *outbound* on 443, so NAT no longer matters and no TURN server (with its own ports,
credentials and abuse surface) is needed. P2P with TURN still leaves hits decided by the shooter's client, which is
trivially forged; a server decides them once, the same for both players. A 1v1 duel at 30 Hz is a few KB/s, so the
server cost is negligible. The price: latency to the server instead of between players, handled by prediction and
interpolation (`NETWORKING.md`).

---

## ADR-003 - Vite + TypeScript; Node runs the server's TypeScript directly

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** Client: Vite + TypeScript, built to one `index.html` with `vite-plugin-singlefile`. Server: TypeScript
run directly by Node.js 26 LTS (type stripping, stable and without flags), so no server build step; `tsc --noEmit`
checks types; tests with `node:test`. Dependencies: `three`, `ws`, `vite`, `vite-plugin-singlefile`, `typescript`
(plus type packages).

**Alternatives.** Plain JavaScript (no types); a bundler for the server (esbuild, tsup); `tsx`/`ts-node`; Jest or
Vitest for tests.

**Reason.** The protocol and the simulation are shared by client and server; types catch mismatches at compile time
instead of during a match. Node 26 removes the need for a server build or a TS runner, and `node:test` needs no
dependency. Constraint accepted: only erasable TypeScript (no `enum`, `namespace` or parameter properties),
enforced with `erasableSyntaxOnly`; relative imports name the `.ts` extension.

---

## ADR-004 - Game files and game server on one host, not GitHub Pages + server

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** One Node process serves the built client, the WebSocket `/ws` and `GET /status` under one HTTPS origin
(`https://swapduel.damiankowalski.pl`). GitHub Pages is switched off (or turned into a redirect) after the deployment
in P3. The `index.html` attached to GitHub releases is an archive copy: downloaded, it runs only the bot mode.

**Alternatives.** Client on GitHub Pages, only the WebSocket on the server.

**Reason.** (1) Client and server are always the same version: with Pages, a merge publishes a new client at once
while the server waits for a manual deployment, and players get an incompatible pair. (2) One origin: the server
accepts only its own `Origin`, no CORS. (3) The extra traffic (a few hundred KB per visit) is negligible.

---

## ADR-005 - One match at a time (configurable), with timeouts

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** The server runs at most `MAX_ROOMS` rooms (default `1`); the code handles N rooms. Further create or
join attempts get a clear "server busy" refusal. Timeouts free the slot: waiting room 3 min, idle player 60 s, dead
socket about 10 s (heartbeat), match at most 20 min. `GET /status` returns `free` or `busy`, shown in the menu.
At most 2 sockets per match; caps per IP and on pending handshakes.

**Alternatives.** Unlimited rooms; a matchmaking queue.

**Reason.** Not capacity (the server could run dozens), but a smaller attack surface (no room-creation floods), a
simpler and more debuggable PoC, and the room code acting as a password. The timeouts prevent one abandoned tab from
holding the only slot. Raising the limit is one variable.

---

## ADR-006 - The agent has no server access; deployment by runbook

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** Coding agents never get SSH or any credentials for the server or DNS. They read the private
infrastructure repository, prepare read-only check commands and deployment runbooks; the owner runs them and pastes
results back.

**Alternatives.** SSH for the agent; automatic deployment from GitHub Actions.

**Reason.** The server hosts other applications with private data. Keeping every server change in the owner's hands
(and every runbook reviewable) is worth more than the convenience. Automatic deployment can be reconsidered later.

---

## ADR-007 - Deployment as a hardened container behind an outbound tunnel

**Date:** 2026-11-14 · **Status:** accepted (owner, 2026-11-14)

**Decision.** The game server runs as a container in its own compose project with no published ports. An outbound
tunnel connector (a second container) is the only way in. The game container sits only on an *internal* network
shared with the connector, so it has no route to the internet, the host or other services. Inside the container the
server binds `0.0.0.0:8080`; locally it defaults to `127.0.0.1`.

**Alternatives.** The kickoff's design: a host process (systemd unit) on `127.0.0.1` behind an existing reverse proxy.

**Reason.** The reconnaissance showed the target server's convention is containers behind per-application outbound
tunnels, with no reverse proxy and no web ports open. Following it avoids a new runtime and a new ingress path on the
host. It also adds what a host process would not have: no outbound network at all for the game process. The
original intent (reachable only through the front door, never directly) is kept. Consequence for P2: the server
must take the client IP from a configurable trusted header (`CLIENT_IP_HEADER`), because every socket arrives from
the connector.

---

## ADR-008 - Keep the P2P online mode through P1 (PeerJS from npm, temporary)

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** P1 moves the game to Vite + TypeScript without dropping the existing P2P online mode: `peerjs` becomes
an npm dependency of the client until P2 replaces it with the game server, then it is removed.

**Alternatives.** Drop online play in P1 and ship only the bot mode until P2.

**Reason.** `main` must always run (AGENTS.md); keeping a working online mode costs one temporary dependency and no
new design. The dependency is bundled at build time, so no CDN is used at runtime.

---

## ADR-009 - Invite-only access gate for the first deployment

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** For P3 and the first online tests, an access gate at the edge (players sign in with a one-time e-mail
code) sits in front of the whole game host. Opening the game to the public is a later, separate decision.

**Alternatives.** Public from day one, relying on the game's own limits.

**Reason.** Unauthenticated visitors never reach the game process, which shrinks the main threat (an exploit in
message handling, `SECURITY.md` T1) to invited players, and makes squatting the only match slot impractical. It
costs no code: the gate's cookie travels with the same-origin WebSocket upgrade. The game's own protections stay in
place unchanged, so removing the gate later needs no redesign.

---

## ADR-010 - Container image built by GitHub Actions and published to GHCR

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** A tag `vX.Y.Z` triggers a GitHub Actions workflow that builds the image and publishes it as a public
package `ghcr.io/damiankowalski/swapduel:X.Y.Z`. The server only pulls a named version.

**Alternatives.** Build the image on the server from the clone.

**Reason.** The same image is tested and deployed; the server needs no build tools and no registry login (public
repository, public package); rollback is pulling the previous tag.

---

## ADR-011 - Keep v0.1.0's library versions during the restructure

**Date:** 2026-11-14 · **Status:** accepted

**Decision.** P1 pins `three` at 0.160.0 and `peerjs` at 1.5.4 (exact versions, as v0.1.0 loaded them from the CDN).
Upgrades come later as separate pull requests (Dependabot proposes them).

**Alternatives.** Move to the latest Three.js in the same pull request.

**Reason.** P1 must not change the game; newer Three.js releases change rendering defaults and APIs, which would mix
a visual change into a structural one. A separate upgrade is easy to review and to revert.
