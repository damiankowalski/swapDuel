# Networking design

Status: **design only** (P0). Implemented in P2; this file is updated with every netcode change. Numbers marked
*(tune)* are starting values.

## 1. Goals and non-goals

- Two players anywhere (home Wi-Fi, mobile LTE, CGNAT) can play a fair 1v1 duel.
- The server is the only authority on positions, hits and score.
- The view, which shows the arena *through the opponent's eyes*, stays smooth under realistic latency and jitter.
- Non-goals for the PoC: lag compensation, spectators, matchmaking, more than one match by default, persistence.

## 2. Topology and transport

```
Browser A ──wss://host/ws──┐                       ┌── serves dist/index.html  (GET /)
                           ├── front door (TLS) ───┤── WebSocket              (/ws)
Browser B ──wss://host/ws──┘                       └── room state             (GET /status)
                                                   one Node process, all state in memory
```

- WebSocket over TLS on 443, same origin as the page, path `/ws`. Both clients connect outbound, so NAT does not
  matter (ADR-002).
- Messages are JSON text frames with short keys, at most 1 KB each. JSON is easy to validate and debug; at 30 Hz a
  snapshot is about 200 bytes, so a match is a few KB/s per player. Binary encoding is a later optimisation.
- `permessage-deflate` is off (CPU cost and decompression-bomb risk for no real gain at this size).
- Configuration by environment: `HOST` (default `127.0.0.1`), `PORT` (default `8080`), `MAX_ROOMS` (default `1`),
  `ALLOWED_ORIGIN`, `CLIENT_IP_HEADER` (unset = use the socket address), timeouts below.

## 3. Connection lifecycle and handshake

1. HTTP upgrade on `/ws`. The server checks, before accepting: path, `Origin` equals `ALLOWED_ORIGIN` exactly, the
   per-IP and global connection caps, the pending-handshake cap. Failure: HTTP 403 / 503, no WebSocket.
2. Client sends `hello { v: PROTOCOL_VERSION }` within 5 s *(tune)*, otherwise the socket is closed.
3. Server answers `welcome { v, tickHz: 30, serverTick }` or `reject { reason }` and closes. Reasons:
   `version` (client shows "A new version is available - reload the page"), `busy`, `full`, `bad_code`, `timeout`.
4. Client sends `create {}` or `join { code }`; server answers `room { code, seat }` or `reject`.
5. Both players press *Start*: `ready {}`. The server starts the match with `start { tick, spawns }`.
6. During the match: client -> `input`, server -> `snap` (§6). `leave {}` or a closed socket ends the seat.

`PROTOCOL_VERSION` is an integer in `shared/protocol.ts`, bumped on every incompatible change. Client and server
come from the same build (ADR-004), so a mismatch means a stale tab after a deployment.

## 4. Rooms, the limit and timeouts

- Room code: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no look-alikes), generated with
  `crypto.randomInt` (31^5 ≈ 28.6 million codes). Wrong codes are counted per socket: 5 wrong joins close it.
- At most `MAX_ROOMS` rooms (ADR-005). A full server answers `reject { reason: "busy" }`; the menu reads
  `GET /status` first and shows "A match is in progress - try again in a few minutes".
- At most 2 player sockets per room. A room is `waiting` -> `ready` -> `playing` -> `ended` (freed at once).

| Timeout | Value *(tune)* | Effect |
| --- | --- | --- |
| Handshake (`hello`) | 5 s | Close socket |
| Room waiting for the second player | 3 min | Close room, notify host |
| No input from a player in a match | 60 s | Disconnect that player |
| Heartbeat (ping every 5 s, no pong) | about 10 s | Terminate socket |
| Match length | 20 min | End match, show result |
| Seat held after a dropped socket (§10) | 15 s | Then the match ends |

- Without an access gate in front of the game, add a short per-IP cool-down for creating a room after one expired
  unused, so one client cannot hold the only slot by re-creating it forever.

`GET /status` returns `{ "state": "free" | "busy", "protocol": <int> }` with `Cache-Control: no-store`. It says
nothing about players, codes or addresses.

## 5. Simulation

- Fixed tick **30 Hz** (33.3 ms) on the server. The same pure functions in `shared/` run on the server, in client
  prediction and in headless tests: `step(state, input, dt)`, `resolveCollisions`, `raycastHit`, `spawnPoint(rng)`.
- Inputs are *intents*, not positions: a bitmask (`forward`, `back`, `left`, `right`, `turnLeft`, `turnRight`,
  `fire`). The server applies its own speeds and turn rate, so a client cannot teleport or snap-turn. (Mouse aim in P4
  will send an absolute yaw, clamped to the maximum turn rate per tick.)
- Fire: server-side cooldown 0.12 s; hit-scan from the shooter's eye along the shooter's yaw against the walls, the
  crate and the opponent's hit shape (capsule as a vertical cylinder), at the tick the input is processed.
- Hit -> score +1, the victim respawns at a server-chosen point (P4: brief invulnerability).

## 6. Messages during a match

Client -> server, once per client tick (30 Hz):

```
input { seq: uint32, keys: uint8 bitmask }
```

Server -> client, every tick:

```
snap { tick, ack: last seq processed for this client,
       you: { x, z, yaw }, opp: { x, z, yaw },
       score: [you, opp], ev: [ { k: "shot" | "hit" | "spawn", ... } ] }
```

Events carry tracer endpoints and respawns so both clients draw the same thing. `seq` must grow; the server keeps at
most 4 *(tune)* queued inputs per player and drops the oldest beyond that (a client cannot "bank" moves).

## 7. Client prediction and reconciliation

- The local player's movement is applied immediately with `shared/step` and kept in a list of unacknowledged inputs.
- On each `snap`: take the server's `you` state at `ack`, replay the inputs after `ack`, compare with the predicted
  state. Small errors decay over about 100 ms *(tune)*; errors above 1 m snap.
- Fire is *not* predicted for score: the client may draw its own tracer at once, but hits and score come only from
  the server.

## 8. Opponent interpolation

- Snapshots go into a buffer stamped with the server tick. The opponent is drawn at `renderTick = latestTick -
  delay`, linear between the two surrounding snapshots; yaw along the shortest arc.
- `delay` starts at 100 ms (3 ticks) and adapts: `max(100 ms, 1 tick + 2 x jitter estimate)` *(tune)*, changed
  slowly (time scaling of at most a few percent) so motion never jumps.
- Buffer starvation: extrapolate at most 100 ms, then hold. Every starvation is counted (§11).
- A respawn event cuts the interpolation (no gliding across the arena).

## 9. Hits and latency (PoC limits)

No lag compensation: the server tests the shot against the opponent's *current* server position, while the shooter
sees the opponent about `RTT/2 + delay` in the past. The shooter therefore leads slightly. Acceptable for a PoC at
normal pings; lag compensation (rewinding the target by the shooter's view delay) is on the "Later" list.

## 10. Reconnect

At `room` the server gives each seat a random 128-bit `resume` token (in memory only). If a socket drops during a
match, the seat is held for 15 s *(tune)*; the client reconnects automatically with `hello` + `resume { code, token }`
and gets the next snapshots. After 15 s the match ends for both. Tokens die with the room.

## 11. Metrics

- Server, logged once a minute (no addresses, no codes): tick time avg/max, sockets, rooms, messages and bytes in/out
  per second, rejections and closes by reason (`origin`, `rate`, `size`, `schema`, `unknown_type`, `version`,
  `busy`, timeouts).
- Client debug overlay (dev builds, toggled by a key): RTT, jitter estimate, interpolation delay, buffer depth,
  starvations, prediction corrections (count and size), camera jitter (§12).

## 12. CAMERA

**Problem.** In the default view the camera *is* the opponent: its position and yaw come from the interpolated remote
state. In a normal shooter, interpolation jitter moves one small figure; here it moves the whole screen. Yaw is the
worst: with the game's 75° vertical field of view, 1° of yaw jitter shifts the centre of the picture by about
12 pixels on a 1920-pixel-wide screen.

**Proposal.**

1. **Interpolate, never chase.** Render from the snapshot buffer at `renderTick` (§8), not by lerping towards the
   latest packet as v0.1.0 does. With an adaptive delay, the input to the camera is already continuous.
2. **Filter the camera, not the model.** Run the camera's yaw and position through a One Euro filter (adaptive low-pass:
   strong smoothing when the opponent turns slowly, little lag when they turn fast). Starting values *(tune)*:
   `minCutoff` 1.0 Hz, `beta` 0.02, `dCutoff` 1.0 Hz; yaw filtered as an unwrapped angle.
3. **Cut on teleports.** A respawn event (or a jump above 2 m / 90°) resets the filter and cuts, with a 150 ms
   fade, instead of smoothing across the arena.
4. **One camera for everything.** The reticle projection uses the same filtered camera, so the reticle never jitters
   against the scene.
5. **No camera extrapolation beyond 100 ms**; on starvation the camera eases to a stop.

**Measurement.**

- **Lag simulator** (dev builds and headless tests): wraps the socket with a configurable one-way delay, jitter
  (normal distribution) and stalls (TCP loss appears as head-of-line blocking, so "loss" is simulated as a 200 ms
  stall with a given probability). In the browser via a query string in dev builds only, e.g.
  `?lag=150&jitter=30&stall=0.02`.
- **Headless camera test** (`npm test`, from P2): a bot plays on the real server code; its snapshots pass the lag
  simulator; the client's interpolation and camera filter run at 60 fps. Ground truth is the bot's real path. Metrics:
  - camera yaw jitter = RMS of frame-to-frame change of yaw angular velocity (deg/s per frame), compared with the
    same metric on the ground truth;
  - largest single-frame yaw step beyond the ground truth's;
  - position error against the ground truth delayed by the interpolation delay;
  - number of buffer starvations.
- **Scenarios:** 0 ms; 150 ms ± 30 ms; 150 ms ± 50 ms with 2% stalls; 300 ms ± 80 ms.
- **P2 "done" threshold** *(tune)*: at 150 ms ± 30 ms, camera yaw jitter at most 1.5x the ground truth's, no extra
  frame step above 2°, zero starvations; at 150 ms ± 50 ms with stalls, no frame step above 5°.
- **By eye:** two tabs with the simulator at 150 ms ± 30 ms; the overlay shows the same metrics live.
