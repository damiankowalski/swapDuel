# Status

**Version:** v0.5.0 candidate (P3 deployment files; stacked on P2.5, P2, P1, P0 in review; no tags yet)
· **Updated:** 14 Nov 2026

## Works

- **Game server, locally** (`npm run play`, two tabs at `http://127.0.0.1:8080`): one Node process serves the client,
  `GET /status` (`free`/`busy`) and the WebSocket `/ws`. Authoritative 30 Hz simulation: the server moves fighters
  from key inputs, decides hits and keeps the score. One match at a time (`MAX_ROOMS=1`); other players see "busy".
- **Protocol v2** (v1 before snowballs) with version handshake; every message schema-checked; limits on size, rate, connections per IP,
  pending handshakes, wrong codes; Origin check; heartbeat; timeouts (waiting room 3 min, idle 60 s, match 20 min).
- **Client:** prediction and reconciliation of the local fighter, buffered interpolation of the opponent with an
  adaptive delay, One Euro filter on the camera. Dev builds: lag simulator (`?lag=&jitter=&stall=`) and net overlay.
- **Camera under lag (headless, 150 ms ± 30 ms):** about 3x smoother than v0.1.0, largest yaw jump 1°, jitter below
  the opponent's own motion (`NETWORKING.md` §12).
- **Snowballs** (ADR-013) instead of the laser, online and in training: arcing projectiles simulated by the server,
  5 at the start, +1 every 10 s, no cap; HUD with the stock and a refill bar; a dashed arc and the reticle show the
  landing point; protocol v2.
- **Training (bot)** with snowballs; the bot still does not throw. 93 tests; CI as in P1.

- **Deployment ready, not yet run:** container image (non-root, read-only, no npm), compose file with an internal
  network and the tunnel connector, CI job that starts the hardened image, release workflow to GHCR on a tag.

## Known problems

- **No reconnect:** a dropped connection ends the match for both (ADR-012).
- **No lag compensation:** the thrower leads a moving target a bit more at high ping (`NETWORKING.md` §9).
- **Own snowball vs server:** our own throw is predicted; near misses can look like hits (or the other way round)
  until the server's hit marker decides.
- **Uncapped stock** may reward hiding; to be judged in play (`MAX_AMMO`).
- **Starvations:** a few per minute at ± 30 ms jitter, bridged by up to 100 ms of extrapolation (not visible in
  the metrics).
- **No room-creation cool-down per IP** yet: fine behind the access gate (ADR-009), needed before going public.
- **Online on GitHub Pages / downloaded file:** shows "not available here" (no server); training works.
- **Gameplay gaps:** no respawn protection, the bot never shoots, pitch is always 0, no sound (P4).
- **Snowballs not yet played by two people:** the owner played P2 (laser) in two windows, with and without simulated
  lag; snowballs were checked by the agent in training mode and by tests.

## Next step

Damian merges P0, P1 (switching Pages to GitHub Actions), P2, P2.5 and P3 and the infrastructure pull requests,
tags `v0.5.0` (release workflow publishes the image), then follows the server runbook in the infrastructure repository.
P3 is done after a match home Wi-Fi <-> mobile data and the security checklist.
