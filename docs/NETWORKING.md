# Networking design

Status: **implemented in P2** (local server; deployment in P3). This file is updated with every netcode change.
Numbers marked *(tune)* can still change. Code: `shared/protocol.ts`, `server/`, `client/src/net.ts`, and the pure
netcode in `shared/` (`prediction.ts`, `interpolation.ts`, `one-euro.ts`, `lag.ts`).

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
- Configuration by environment (`server/config.ts`): `HOST` (default `127.0.0.1`), `PORT` (default `8080`),
  `MAX_ROOMS` (default `1`), `ALLOWED_ORIGINS` (comma-separated exact origins; required when `HOST` is not loopback;
  the local default allows ports 8080 and 5173), `CLIENT_IP_HEADER` (unset = use the socket address),
  `MAX_CONNECTIONS` (16), `MAX_CONNECTIONS_PER_IP` (4), `MAX_PENDING_HANDSHAKES` (8), and the timeouts below in
  seconds (`HANDSHAKE_TIMEOUT_S`, `WAITING_ROOM_TIMEOUT_S`, `IDLE_TIMEOUT_S`, `HEARTBEAT_INTERVAL_S`, `MATCH_MAX_S`, `REMATCH_TIMEOUT_S`).

## 3. Connection lifecycle and handshake

1. HTTP upgrade on `/ws`. The server checks, before accepting: path (exactly `/ws`), `Origin` is one of
   `ALLOWED_ORIGINS` exactly, the client IP is known, the pending-handshake cap, the per-IP and global connection
   caps. Failure: HTTP 404 / 403 / 400 / 503, no WebSocket.
2. Client sends `hello { v: PROTOCOL_VERSION }` within 5 s *(tune)*, otherwise the socket is closed.
3. Server answers `welcome { v, tickHz: 30, serverTick }` or `reject { reason }` and closes. Reasons:
   `version` (client shows "A new version is available - reload the page"), `busy`, `full`, `bad_code`, `timeout`,
   `protocol`.
4. Client sends `create { map? }` (the arena: `classic` by default, or `moat`) or `join { code }`; server answers
   `room { code, seat }` or `reject`.
5. When the second player joins, the server starts the match at once: `start { tick, you, opp, go, map }` to both (the guest learns the arena here), where
   `go` is the countdown (3 s): until then inputs are acknowledged but nobody moves, throws or gets snowballs. (There
   is no `ready` step: until a player clicks the start screen, the client sends empty inputs, and the idle timeout
   covers a player who never starts.)
6. During the match: client -> `in`, server -> `snap` (§6). When a player reaches 10 points (`WIN_SCORE`) the server
   sends `over { score, winner }` and stops the match, but keeps the room: each player may send `rematch {}`; the
   other one is told (`rematch {}`); when both asked, a new `start` follows (tick 0 again, countdown, fresh stock).
   Without both requests within 60 s the room closes (`end { reason: "room_expired" }`).
7. `leave {}` or a closed socket ends the match (or the waiting rematch) for both; the server sends
   `end { reason }` (`opponent_left`, `time_limit`, `idle`, `room_expired`, `server_shutdown`) and closes the
   socket. A new game uses a new socket.

`PROTOCOL_VERSION` is an integer in `shared/protocol.ts`, bumped on every incompatible change. Client and server
come from the same build (ADR-004), so a mismatch means a stale tab after a deployment.

## 4. Rooms, the limit and timeouts

- Room code: 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no look-alikes), generated with
  `crypto.randomInt` (31^5 ≈ 28.6 million codes). Wrong codes are counted per socket: 5 wrong joins close it.
- At most `MAX_ROOMS` rooms (ADR-005). A full server answers `reject { reason: "busy" }`; the menu reads
  `GET /status` first and shows "A match is in progress - try again in a few minutes".
- At most 2 player sockets per room. A room is `waiting` -> `playing` -> `over` -> (`playing` again after a rematch)
  -> closed (freed at once).

| Timeout | Value *(tune)* | Effect |
| --- | --- | --- |
| Handshake (`hello`) | 5 s | Close socket |
| Room waiting for the second player | 3 min | Close room, notify host |
| No key pressed by a player in a match | 60 s | End the match (`idle` / `opponent_left`) |
| Heartbeat (ping every 5 s, no pong) | about 10 s | Terminate socket |
| Match length | 20 min | End match (`time_limit`); normally 10 points come first |
| Finished match waiting for a rematch | 60 s | Close room (`room_expired`) |
| Seat held after a dropped socket | - | Not in P2: a dropped socket ends the match (§10) |

- Not implemented yet: a short per-IP cool-down for creating a room after one expired unused, so one client cannot
  hold the only slot by re-creating it forever. Not needed while the access gate is in front (ADR-009); required
  before the game is opened to the public.

`GET /status` returns `{ "state": "free" | "busy", "protocol": <int> }` with `Cache-Control: no-store`. It says
nothing about players, codes or addresses.

## 5. Simulation

- Fixed tick **30 Hz** (33.3 ms) on the server. The same pure functions in `shared/` run on the server, in client
  prediction and in headless tests: `step(state, input, dt)`, `resolveCollisions`, `raycastHit`, `spawnPoint(rng)`.
- Inputs are *intents*, not positions: a bitmask (`forward`, `back`, `left`, `right`, `turnLeft`, `turnRight`,
  `fire`). The server applies its own speeds and turn rate, so a client cannot teleport or snap-turn. (Mouse aim in P4
  will send an absolute yaw, clamped to the maximum turn rate per tick.)
- **Snowballs** (protocol v2, ADR-013; `shared/snowball.ts`). Each player starts with 5; one more every 10 s, no
  cap (`MAX_AMMO`). A throw needs a new press of fire (`KEY_FIRE` going from 0 to 1 between two applied inputs), at
  least 0.3 s after the previous throw, and a snowball in stock. It leaves the hand 0.5 m in front at 1.5 m height,
  at 20 m/s and 8° above the horizon (about 18 m of range on flat ground), and falls with gravity.
- The server moves every snowball each tick in 1/240 s physics steps against the other player's body (capsule) and
  head (sphere), the crate, the walls and the floor. At most 64 snowballs fly at once; one melts after 4 s.
- Hit -> score +1, the victim respawns at a server-chosen point and keeps its snowballs; for 1.5 s
  (`SPAWN_PROTECTION`) snowballs fly through it. Clients make a protected fighter blink (they know from the `spawn`
  event; no extra field). The first to 10 points (`WIN_SCORE`) wins; the match then stops stepping (ADR-014).
- **Arenas** (`shared/maps.ts`, ADR-015): every rule takes the arena (walls, crates, spawn points, snowball
  collisions). On the moat, a fighter whose centre passes the ditch's edge by 0.3 m falls in: `fall { who }`, a point
  for the other player, a respawn with protection, as after a hit. Prediction uses the same arena, so the client walks
  into the ditch and the server's snapshot teleports it.

## 6. Messages during a match

Client -> server, once per client tick (30 Hz):

```
in { s: uint32 sequence, k: 7-bit key mask (forward 1, back 2, left 4, right 8, turnLeft 16, turnRight 32, fire 64) }
```

Server -> client, every tick:

```
snap { tick, ack: last seq processed for this client,
       you: { x, z, yaw }, opp: { x, z, yaw },
       score: [you, opp], ammo: your snowballs, next: seconds until the next one,
       ev: [ throw { by, id, from, vel } | splat { id, at } | hit { by } | fall { who } | spawn { who, x, z } ] }
```

A `throw` carries the snowball's start and velocity: the flight is deterministic, so clients draw it without a
position per tick, and `splat` says where and when it ended. `s` must grow (a repeated or older
number closes the socket); the server keeps at most 4 *(tune)* queued inputs per player and drops the oldest beyond
that (a client cannot "bank" moves). It applies one input per tick, two when more than two are queued.

## 7. Client prediction and reconciliation

- The local player's movement is applied immediately with `shared/step` and kept in a list of unacknowledged inputs.
- On each `snap`: take the server's `you` state at `ack`, replay the inputs after `ack`, compare with the predicted
  state. Small errors decay over about 100 ms *(tune)*; errors above 1 m snap.
- Throws are predicted: the client keeps a copy of the throwing rules, so its own snowball leaves the hand at once;
  the stock shown is the server's minus throws not yet acknowledged. Hits and score come only from the server (our
  own snowball may look like it hit, or missed, when the server decided otherwise).
- The opponent's snowballs are drawn on the opponent's delayed clock (the interpolation's `renderTick`), from the
  `throw` tick until the `splat` tick, so they leave the opponent's hand where we see the opponent.
- A tap of fire shorter than one client tick is latched until the next tick, so it is never lost.

## 8. Opponent interpolation

- Snapshots go into a buffer stamped with the server tick. The client tracks how late each snapshot arrives
  compared with the fastest one of the last 3 s (90 snapshots). The opponent is drawn at
  `renderTime = now - fastestOffset - delay`, linear between the two surrounding snapshots; yaw along the shortest arc.
- `delay` starts at 100 ms and adapts to `max(100 ms, 1 tick + spread + 10 ms)`, where `spread` is the difference
  between the latest and the fastest arrival in the window *(tune)*. It grows at most 10% of real time (the
  opponent plays slightly slower) and shrinks at most 2% (slightly faster), so motion never jumps.
- Buffer starvation: extrapolate at most 100 ms, then **pause** the opponent's clock (the delay grows by the length
  of the stall) instead of jumping forward when data returns; the extra delay is played off slowly. Every
  starvation is counted (§11).
- A respawn event cuts the interpolation (no gliding across the arena) and resets the camera filter.

## 9. Hits and latency (PoC limits)

No lag compensation: the server flies each snowball against the opponent's *current* server position, while the
thrower sees the opponent about `RTT/2 + delay` in the past. With snowballs the thrower must lead a moving target
anyway (about 0.5 s of flight over 10 m); the network adds a little to that lead. Lag compensation is on the "Later"
list.

## 10. Reconnect

**Not in P2** (ADR-012): a dropped socket ends the match for both, with a clear message. Planned for later: at
`room` the server gives each seat a random 128-bit `resume` token (in memory only); a dropped seat is held for 15 s
and the client reconnects with `hello` + `resume { code, token }`.

## 11. Metrics

- Server, one JSON log line a minute (no addresses, no codes): sockets, rooms, messages in/out, bytes in, refused
  upgrades by reason (`path`, `origin`, `no_client_ip`, `pending`, `too_many`, `too_many_from_ip`), closed sockets
  by reason (`normal`, `schema`, `rate`, `protocol`, `sequence`, `binary`, `wrong_codes`, `handshake_timeout`,
  `heartbeat`, `error`) and the longest tick. Plus one line per room created, match started and room closed.
- Client overlay (dev builds, with `?debug` or a lag setting): RTT, interpolation delay, jitter spread,
  starvations, prediction corrections (count and size of the last).

## 12. CAMERA

**Problem.** In the default view the camera *is* the opponent: its position and yaw come from the interpolated remote
state. In a normal shooter, interpolation jitter moves one small figure; here it moves the whole screen. Yaw is the
worst: with the game's 75° vertical field of view, 1° of yaw jitter shifts the centre of the picture by about
12 pixels on a 1920-pixel-wide screen.

**Proposal.**

1. **Interpolate, never chase.** Render from the snapshot buffer at `renderTick` (§8), not by lerping towards the
   latest packet as v0.1.0 does. With an adaptive delay, the input to the camera is already continuous.
2. **Filter the camera, not the model.** Run the camera's yaw and position through a One Euro filter (adaptive low-pass:
   strong smoothing when the opponent turns slowly, little lag when they turn fast). Values *(tune)*: yaw
   `minCutoff` 1.0 Hz, `beta` 3.0, `dCutoff` 1.0 Hz (about 3 degrees of lag at full turn speed); position `beta` 1.5;
   yaw filtered as an unwrapped angle. (The first guess, `beta` 0.02, lagged 16 degrees behind a full-speed turn.)
3. **Cut on teleports.** A respawn event resets the filter and cuts, instead of smoothing across the arena.
4. **One camera for everything.** The reticle projection uses the same filtered camera, so the reticle never jitters
   against the scene.
5. **No camera extrapolation beyond 100 ms**; on starvation the camera eases to a stop.

**Measurement.**

- **Lag simulator** (`shared/lag.ts`; dev builds and headless tests): one-way delay, jitter (normal distribution) and
  stalls (TCP loss appears as head-of-line blocking, so "loss" is a 200 ms stall with a given probability), applied
  to both directions, never reordering messages. In the browser in dev builds only:
  `npm run dev` + `npm run server`, then `http://127.0.0.1:5173/?lag=150&jitter=30&stall=0.02`.
- **Headless camera test** (`tools/netplay.ts`, run by `npm test` and `npm run sim -- --net`): the real server match
  logic with a scripted opponent (walking, strafing, turning); its snapshots pass the lag simulator; the client's
  interpolation and camera filter run at 60 fps. Ground truth is the opponent's real path. Metrics:
  - yaw jerk = RMS of the frame-to-frame change of the yaw step (deg/frame²), for the camera and the truth;
    *jitter ratio* = camera / truth;
  - largest yaw step in one frame beyond what a fighter can really turn in a frame (2.3° at 60 fps);
  - largest position step beyond what a fighter can really walk in a frame (0.1 m);
  - buffer starvations.
- **Thresholds enforced by the tests** (three seeds, 2-minute matches) *(tune)*:

  | Scenario | Thresholds | Measured (worst seed) |
  | --- | --- | --- |
  | 150 ms ± 30 ms | jitter ratio ≤ 1.0, yaw jump ≤ 1.5°, position jump ≤ 0.1 m, yaw jerk ≤ half of v0.1.0's, ≤ 10 starvations | 0.83, 1.01° (v0.1.0: 3.3°), 0.04 m, 0.19 vs 0.64, 8 |
  | 150 ms ± 50 ms, 2% stalls of 200 ms | yaw jump ≤ 5°, jitter ratio ≤ 1.2, smaller jumps than v0.1.0 | 3.6° (v0.1.0: 7.8°), 0.89 |
  | 300 ms ± 80 ms | yaw jump ≤ 2°, jitter ratio ≤ 1.0 | 1.08° (v0.1.0: 6.1°), 0.86 |
  | no lag | no starvation, delay 100 ms | 0, 100 ms |

  The first design target was "zero starvations"; with a delay of about 160 ms there are still a few per minute at
  ± 30 ms. Each is bridged by at most 100 ms of extrapolation and does not show in the camera metrics, so the
  threshold is "rare" rather than zero, which keeps the delay (and the latency) lower.
- **By eye:** two tabs with the simulator at 150 ms ± 30 ms; the overlay shows RTT, delay, spread and starvations.
