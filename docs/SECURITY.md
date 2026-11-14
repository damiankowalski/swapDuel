# Security

Threat model and protections of the game itself. Deliberately generic: this repository is public, so it contains no
details of the infrastructure the game runs on. Status: the **application layer (§3) is implemented** (P2, tested in
`server/app.test.ts`, `server/*.test.ts`, `shared/protocol.test.ts`); the process layer (§4) is in `deploy/` (P3,
checked by the CI job `image`) and is proven on the server by the checklist (§6). Updated with every server or
deployment change.

## 1. What we protect

The game stores nothing worth stealing: no accounts, no database, no files, no secrets. The asset is **the machine it
runs on and its neighbours**: the game will share a server with other applications that do hold private data. So the
main question is not "can someone break the game" but "can a flaw in the game become a way into anything else".

## 2. Threats

| # | Threat | Example | Main defences |
| --- | --- | --- | --- |
| T1 | Code execution in the game process, then lateral movement | A parsing bug or a vulnerable dependency; the attacker then looks for databases, secrets or other services | §3 validation; §4 isolated, unprivileged process with no outbound network |
| T2 | Denial of service | Connection floods, message floods, huge frames, holding the only match slot | Caps, rate limits, `maxPayload`, timeouts, resource limits, the edge in front |
| T3 | Cheating | Forged hits, teleporting, speed hacks | Authoritative server; inputs are intents, not positions (`NETWORKING.md` §5) |
| T4 | Cross-site WebSocket use | Another site opens a socket to the game from a visitor's browser | Exact `Origin` check |
| T5 | Supply chain | A compromised npm package or CDN file | Minimal dependencies, lockfile, audit, Dependabot, no CDN at runtime |
| T6 | Privacy | Logs that keep players' IP addresses | No raw IPs in logs |
| T7 | Secret leaks | A token committed to this public repository | The game has no secrets; deployment secrets live only on the server |

## 3. Application layer (the game's own code)

- **No database, no disk writes, no secrets** in the game process. All state is in memory and dies with the process.
- **Every message is validated** against a schema per type: JSON object, known `t`, every field of the right type,
  finite numbers within range, integers where expected, strings matched by a strict pattern and length. An unknown
  type, a binary frame or any invalid field **closes the connection** (no "best effort" parsing). No `eval`, no
  dynamic `import()`, no object spreading of untrusted input into state (prototype pollution).
- **Limits:** `maxPayload` 1 KB; per-socket rate limit (token bucket: input messages burst 10 then 40/s, other
  messages burst 5 then 5/s); 5 wrong room codes close the socket; connection caps per client IP (4) and in total
  (16); a cap on pending handshakes (8) with a 5 s timeout; heartbeat ping/pong every 5 s (dead sockets gone within
  about 10 s); `permessage-deflate` off; input sequence numbers must grow and at most 4 inputs are queued; a throw
needs ammo, a new key press and 0.3 s since the last one, and at most 64 snowballs fly at once.
- **Origin:** the upgrade is accepted only when `Origin` exactly equals one of the configured origins
  (`ALLOWED_ORIGINS`; the server refuses to start on a non-loopback address without it). Missing or other origins get
  HTTP 403.
- **Client IP:** taken from a configurable header set by the trusted front door (`CLIENT_IP_HEADER`), and only when
  that is configured; otherwise the socket address. When configured and missing, the upgrade is refused (400). The
  header is trusted only because the process is unreachable except through the front door (§4).
- **One match at a time** (ADR-005) with timeouts, so floods of rooms are impossible and an abandoned tab cannot hold
  the slot.
- **HTTP surface:** only `GET /`, the built static file, `GET /status` and the `/ws` upgrade; everything else 404. No
  directory listing, no source maps in production. Security headers: a Content-Security-Policy allowing only the
  page's own inline script (by hash) and `connect-src 'self'`, `frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Dependencies:** runtime only `ws` (and Node itself); `three` is bundled into the client at build time. Lockfile
  committed, `npm ci` everywhere, `npm audit` in CI, Dependabot on. A new dependency needs an ADR.
- **Logs:** events and counters, never message contents; no raw IP addresses (at most a hash with a per-process
  random salt, for rate-limit debugging).

## 4. Process layer (how the game runs)

- For the first deployment an invite-only access gate at the edge keeps unauthenticated visitors away from the game
  process entirely (ADR-009). Everything below holds without it too.

- A container with: a non-root user, a read-only file system, all Linux capabilities dropped, `no-new-privileges`,
  memory, CPU and process-count limits, no volumes, no access to the container runtime's socket.
- **No published ports.** The only way in is an outbound tunnel connector in a separate container.
- **No outbound network:** the game container is attached only to an internal network shared with the connector. It
  cannot reach the internet, the host, cloud metadata services or other applications' networks, which removes the
  "next step" of an attacker who got code execution.
- TLS ends at the edge in front of the tunnel; the hop from the connector to the game is on the private network.

## 5. Host layer

Audited separately and privately by the owner (exposure of other services, firewall, isolation between applications).
Agents never change the server; they prepare runbooks the owner runs (ADR-006).

## 6. Deployment checklist (ticked off by the owner at the first deployment; the runbook has the commands)

- [ ] Image runs as non-root; file system read-only; capabilities dropped; `no-new-privileges`; resource limits set.
- [ ] No published ports; the game container is only on the internal network.
- [ ] From a throwaway container on that network: no answer from the internet, the cloud metadata address, the
      host's addresses or another application's services.
- [ ] `wss://` from the real origin works; a socket with another `Origin` is refused (403).
- [ ] A third client gets "busy"; oversized frame, binary frame, unknown type and invalid fields close the socket.
- [ ] Rate limit and per-IP cap trigger as configured, with the client IP taken from the trusted header.
- [ ] Timeouts free the slot (waiting room, idle player, dead socket).
- [ ] Security headers present on `GET /`; `/status` reveals only `free`/`busy` and the protocol number.
- [ ] Logs contain no IP addresses and no message contents.
- [ ] `npm audit` clean (or each finding explained); Dependabot on.
- [ ] No secret in the repository or the image (the tunnel token lives only in the server's environment file).

## 7. Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting for this repository ("Report a
vulnerability" under the *Security* tab) or contact the owner through GitHub.
