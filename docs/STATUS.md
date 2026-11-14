# Status

**Version:** v0.1.0 (commit `9366bb2`, 24 Aug 2026; no git tag or GitHub release exists yet) · **Package:** P0 in review
· **Updated:** 14 Nov 2026

## Works

- One file, `index.html`: Three.js 0.160 and PeerJS 1.5.4 from unpkg, no build. Served by GitHub Pages from `main`.
- **Training (bot):** the bot wanders and looks around at random; your hits score and respawn it.
- **Online (P2P):** host gets a 5-character code, guest types it; PeerJS (public broker, STUN only) opens a WebRTC
  data channel; each side sends its position and yaw about 30 times a second.
- Controls: `WASD` move, arrows turn, `Space` fire (0.12 s auto-fire), `V` toggles view; projected amber reticle.

## Known problems

- **NAT:** no TURN server, so double NAT / CGNAT players never connect (stuck on "connecting").
- **Shooter decides hits:** the shooter's client raycasts against its own smoothed copy of the opponent and sends
  `hit`; the victim obeys and respawns. Forging `hit` is trivial; each client keeps its own score.
- **No validation and no protocol version:** incoming fields are used as-is (`NaN` or huge values break the scene).
- **Room code:** `Math.random().toString(36)` starts with `0.`, so the first character is always `0` (4 random
  characters in practice); IDs share the public broker's namespace (`swapduel-<code>`).
- **Disconnects:** handled only by a status text in the hidden lobby; the game keeps running with a frozen opponent.
- **Remote motion:** exponential smoothing, no interpolation buffer; in the default view the *camera* is the remote
  player, so network jitter shakes the whole screen.
- **Gameplay gaps:** no respawn protection, the bot never shoots, pitch is always 0 (no mouse / pointer lock although
  the start screen implies it), no sound.
- **Dependencies:** loaded from a CDN without integrity hashes; no `package.json` or lockfile.
- **UI and code comments in Polish** (to translate in P1).

## Technical debt

No tests, no build, no CI, no type checking. Rendering, input, rules, bot and networking are mixed in one script;
simulation constants and collision code need to move to `shared/` to be reused by the server and tests.

## Next step

Damian reviews and merges the P0 pull requests (this repository and the private infrastructure one); the P0
decisions are taken (ADR-007 to ADR-010). Then **P1**: restructuring into `client/` + `shared/` with
Vite and TypeScript, no gameplay change.
