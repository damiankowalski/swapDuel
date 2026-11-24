# Status

**Version:** v0.6.0 candidate (P4a match rules in review) · **Deployed:** v0.5.0 at
`https://swapduel.damiankowalski.pl` behind an invite-only access gate · **Updated:** 24 Nov 2026

## Works

- **Online, deployed (v0.5.0):** hardened container behind an outbound tunnel; a match home Wi-Fi <-> mobile data
  worked. One match at a time (`MAX_ROOMS=1`); authoritative 30 Hz server; prediction, interpolation, filtered camera.
- **Snowballs:** arcing projectiles simulated by the server; 5 at the start, +1 every 10 s, no cap; HUD with the
  stock; a dashed arc and the reticle show the landing point.
- **Match rules (P4a, this version):** first to 10 wins; end screen with Rematch (both must ask, 60 s); 3-2-1
  countdown; 1.5 s spawn protection with blinking; a ring under your own fighter; the training bot aims and throws.
  Protocol v3.
- **Quality:** 103 tests (unit, socket integration, camera metrics under simulated lag); CI also starts the hardened
  image; release workflow publishes the image on a tag.

## Known problems

- **No reconnect:** a dropped connection ends the match for both (ADR-012).
- **No lag compensation:** the thrower leads a moving target a bit more at high ping.
- **Own snowball vs server:** our own throw is predicted; near misses can look like hits until the server decides.
- **Uncapped stock** may reward hiding (`MAX_AMMO`); first-to-10 should limit it, to be judged in play.
- **No room-creation cool-down per IP:** fine behind the access gate, needed before going public.
- **GitHub Pages** still publishes an old static copy until the owner switches it off.
- **Not verified by eye:** the online end screen and rematch between two people (covered by server tests).

## Next step

Damian reviews and merges P4a, tags `v0.6.0` and updates the server (runbook "update to a new version"). Then **P4b**
(Arena 2 with a ditch) and **P4c** (winter look and sound).
