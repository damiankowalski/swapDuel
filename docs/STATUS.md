# Status

**Version:** v0.3.0 candidate (P2 in review, stacked on P1 and P0; last release commit v0.1.0 `9366bb2`, no tags yet)
· **Updated:** 14 Nov 2026

## Works

- **Game server, locally** (`npm run play`, two tabs at `http://127.0.0.1:8080`): one Node process serves the client,
  `GET /status` (`free`/`busy`) and the WebSocket `/ws`. Authoritative 30 Hz simulation: the server moves fighters
  from key inputs, decides hits and keeps the score. One match at a time (`MAX_ROOMS=1`); other players see "busy".
- **Protocol v1** with version handshake; every message schema-checked; limits on size, rate, connections per IP,
  pending handshakes, wrong codes; Origin check; heartbeat; timeouts (waiting room 3 min, idle 60 s, match 20 min).
- **Client:** prediction and reconciliation of the local fighter, buffered interpolation of the opponent with an
  adaptive delay, One Euro filter on the camera. Dev builds: lag simulator (`?lag=&jitter=&stall=`) and net overlay.
- **Camera under lag (headless, 150 ms ± 30 ms):** about 3x smoother than v0.1.0, largest yaw jump 1°, jitter below
  the opponent's own motion (`NETWORKING.md` §12).
- **Training (bot)** unchanged. PeerJS removed. 89 tests (unit, socket integration, camera metrics); CI as in P1.

## Known problems

- **No reconnect:** a dropped connection ends the match for both (ADR-012).
- **No lag compensation:** at high ping the shooter must lead the target slightly (`NETWORKING.md` §9).
- **Starvations:** a few per minute at ± 30 ms jitter, bridged by up to 100 ms of extrapolation (not visible in
  the metrics).
- **No room-creation cool-down per IP** yet: fine behind the access gate (ADR-009), needed before going public.
- **Online on GitHub Pages / downloaded file:** shows "not available here" (no server); training works.
- **Gameplay gaps:** no respawn protection, the bot never shoots, pitch is always 0, no sound (P4).
- **Not verified by a human:** a full match between two real players (the agent tested with one browser tab and a
  scripted second player).

## Next step

Damian merges P0, P1 (switching Pages to GitHub Actions), then P2; tags `v0.2.0` / `v0.3.0` as wanted; tries
`npm run play` with two windows. Then **P3**: deployment on the server by runbook.
