# Roadmap

One package = one branch = one pull request. Sizes: **S** (a day or less), **M** (a few days), **L** (a week or more).
Merge and release only after the owner approves. Versions are tagged at the end of a package.

## Done

- **v0.1.0** (Aug 2026): PoC in one `index.html` - second-person view, bot training, P2P online through PeerJS.
- **P0** (Nov 2026): agent contract, docs, server reconnaissance and security assessment (infrastructure repository).
- **P1 · v0.2.0**: `client/` + `shared/`, Vite + TypeScript, English UI, tests, CI, Pages from Actions.
- **P2 · v0.3.0**: authoritative WebSocket server (rooms, `MAX_ROOMS=1`, limits, timeouts), prediction,
  interpolation, camera filter, lag simulator; camera smoothness tested headlessly (ADR-012).
- **P2.5 · v0.4.0**: snowballs instead of the laser (ADR-013), protocol v2.
- **P3 · v0.5.0** (deployed Nov 2026): hardened container image, compose file with an internal network and the tunnel
  connector, release workflow to GHCR, runbook in the infrastructure repository; deployed behind an invite-only
  access gate; a match home Wi-Fi <-> mobile data worked (owner, 24 Nov 2026). GitHub Pages switched off afterwards (its
  workflow removed).

## Next

### P4a - Match rules · M · v0.6.0 · *done, deployed 24 Nov 2026*

First to 10 points wins; an end screen with **Rematch** (both players must ask; the room waits 60 s); a 3-2-1
countdown before every match; 1.5 s of spawn protection (snowballs fly through, the fighter blinks); a ring on the
ground under your own fighter; a training bot that aims and throws. Protocol v3 (ADR-014).

**Done when:** both modes end at 10 with a winner and a rematch; the rules are server-side and tested.

### P4b - Arena 2 with a ditch · M · v0.7.0 · *in review*

A bigger arena (about 28 x 28 m) with a ditch along the walls: falling in gives the opponent a point (like a hit) and
respawns you; two or three smaller crates instead of one big one. The host picks the map when creating a game; the bot
avoids the ditch. Same match rules as P4a.

**Done when:** both maps are playable online and in training; falling in scores for the opponent; tests cover the
ditch, the map choice and the bot.

Built as planned (ADR-015): arena "Frozen moat", 28 x 28 m, ditch 1.6 m wide and 1.2 m deep, three crates.

### P4c - Winter look and sound · M · v0.8.0

Textures generated locally by the owner's image models (snow ground, walls, crates, sky; small files, licences
checked), snowmen fighters built from simple shapes, simple animations in code (walk, throw, hit, fall), sounds
generated with Web Audio (throw, splat, hit, point, win). The Three.js upgrade proposed by Dependabot is tested here.

**Done when:** the game looks wintry, gives audible feedback, and the single-file build stays small (about 1 MB).

## Later

Reconnect into a running match (ADR-012), lag compensation, mouse aim (pointer lock, pitch), a per-IP room
cool-down before the game is opened to the public. Kept out on purpose for now (the swapped camera is demanding
enough): other weapons, power-ups, more than two players.

## Decisions taken in P0

All accepted by the owner on 2026-11-14.

| # | Question | Decision | Record |
| --- | --- | --- | --- |
| O1 | P1: keep the P2P online mode until P2 (PeerJS from npm, temporary dependency) or drop it in P1? | Keep it until P2 | ADR-008 |
| O2 | Put an access gate (invited players only) in front of the game for P3? | Yes for P3 and the first tests; public later as its own decision | ADR-009 |
| O3 | Container image from GitHub Actions on a tag (public registry) instead of building on the server | Yes | ADR-010 |
