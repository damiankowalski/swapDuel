# Status

**Version:** v0.2.0 candidate (P1 in review; last release commit v0.1.0 `9366bb2`, no git tag yet) ·
**Updated:** 14 Nov 2026

## Works

- **Build:** Vite + TypeScript; `npm run build` gives one self-contained `dist/index.html` (about 600 KB, 155 KB
  gzipped; no CDN at runtime). CI runs typecheck, 32 tests, a 2-minute headless match, the build and `npm audit`.
- **Shared simulation** (`shared/`, no Three.js): movement, collisions, bot, hit-scan shots, room codes, P2P message
  validation, headless bot-vs-bot match (`npm run sim`).
- **Training (bot):** as in v0.1.0. **Online (P2P):** as in v0.1.0 (PeerJS public broker, STUN only), now with
  incoming messages validated.
- Controls: `WASD` move, arrows turn, `Space` fire (0.12 s auto-fire), `V` toggles view. UI in English.
- **Changes from v0.1.0 (bug fixes only):** room codes use all 5 characters (the first was always `0`); the join
  field accepts only a well-formed 5-character code; malformed P2P messages are ignored instead of corrupting the
  scene. Hits are computed analytically against the fighter's capsule and head (same shapes as the mesh, so within
  a few centimetres of v0.1.0's mesh raycast).

## Known problems

- **NAT:** no TURN server, so double NAT / CGNAT players never connect (fixed by the server in P2).
- **Shooter decides hits**, each client keeps its own score; no protocol version (P2).
- **Disconnects:** only a status text in the hidden lobby; the game keeps running with a frozen opponent (P2).
- **Remote motion:** exponential smoothing; the camera (the remote player) shakes with network jitter (P2, CAMERA).
- **Gameplay gaps:** no respawn protection, the bot never shoots, pitch is always 0, no sound (P4).
- GitHub Pages must be switched to "GitHub Actions" when P1 is merged (see the P1 pull request).

## Next step

Damian merges P0, then P1 (switching Pages to GitHub Actions at the same time), tags `v0.2.0` and creates the
release with `dist/index.html`. Then **P2**: the game server, locally.
