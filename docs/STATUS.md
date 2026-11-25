# Status

**Version:** v0.8.0 candidate (P4c winter look and sound in review) · **Deployed:** v0.7.0 at
`https://swapduel.damiankowalski.pl` behind an invite-only access gate · **Updated:** 25 Nov 2026

## Works

- **Winter look and sound (P4c, this version):** snowman fighters with team-coloured hats and scarves, animated in
  code (waddle, throwing arm, pop-in after a respawn, a ghost sinking into the ditch, snow bursts); textures generated
  locally (snow, snow-block walls, ice, wooden crates), a sky gradient and falling snow; Web Audio sounds (throw,
  splat, hit, hurt, fall, countdown, win/lose), `M` mutes. Three.js 0.187. Single-file build about 900 kB.
- **Online, deployed (v0.7.0; v0.6.0 first played):** hardened container behind an outbound tunnel; a match home Wi-Fi <-> mobile data
  worked. One match at a time (`MAX_ROOMS=1`); authoritative 30 Hz server; prediction, interpolation, filtered camera.
- **Snowballs:** arcing projectiles simulated by the server; 5 at the start, +1 every 10 s, no cap; HUD with the
  stock; a dashed arc and the reticle show the landing point.
- **Arenas (P4b):** Classic and Frozen moat (28 x 28 m, ditch along the walls: falling in gives the
  opponent a point; three crates); chosen in the menu, the host's choice counts online. Protocol v4.
- **Match rules (P4a):** first to 10 wins; end screen with Rematch (both must ask, 60 s); 3-2-1
  countdown; 1.5 s spawn protection with blinking; a ring under your own fighter; the training bot aims and throws.

- **Quality:** 119 tests (unit, socket integration, camera metrics under simulated lag); CI also starts the hardened
  image; release workflow publishes the image on a tag.

## Known problems

- **No reconnect:** a dropped connection ends the match for both (ADR-012).
- **No lag compensation:** the thrower leads a moving target a bit more at high ping.
- **Own snowball vs server:** our own throw is predicted; near misses can look like hits until the server decides.
- **Uncapped stock** may reward hiding (`MAX_AMMO`); first-to-10 should limit it, to be judged in play.
- **No room-creation cool-down per IP:** fine behind the access gate, needed before going public.
- **Not verified by eye:** P4c between two people online and the sounds by ear (the agent checked training and an
  online start in a browser, without audio); textures repeat visibly on large surfaces.

## Next step

Damian reviews P4c (look, animations, sounds), merges, tags `v0.8.0` and updates the server; Dependabot's Three.js
pull request can then be closed. The next package is picked from "Later" in the roadmap.
