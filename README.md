# Swap Duel

An experimental **second-person shooter** (proof of concept). You steer your own fighter, but the screen shows the
world **through your opponent's eyes**: to hit, you have to learn to aim "backwards". A simple 1v1 duel on a square
arena with one indestructible crate in the middle.

The current version (v0.1.0) is a single `index.html` (Three.js and PeerJS from a CDN). No install and no server:
online play is peer-to-peer through the free PeerJS broker. An authoritative game server is planned - see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Controls

- **W A S D** - move
- **<- ->** - turn left / right
- **Space** - fire (hold for a burst)
- **V** - toggle view (opponent's eyes <-> your own eyes)

The amber reticle shows where your shot will really go. You hit your opponent when the reticle is at the centre of
the screen (the centre is the point they look from).

## Playing online

1. One player picks **Create online game** (*Utwórz grę online*) and gets a 5-character code.
2. The other picks **Join game** (*Dołącz do gry*) and types the code.
3. Once connected, each player clicks the start screen (*Kliknij, aby zacząć*).

There is also a **Training (bot)** mode (*Trening (bot)*) for solo play.

> Note: on some home networks a plain P2P (WebRTC) connection cannot be set up without a TURN server. If it hangs on
> "connecting", that is the most likely cause. The planned game server removes this problem.

The in-game text of v0.1.0 is still in Polish; it is translated in the next version.

## Running locally

Open `index.html` in a desktop browser (Chrome, Edge, Firefox). An internet connection is needed because the
libraries load from a CDN.

## Project docs

- [`docs/STATUS.md`](docs/STATUS.md) - what works, known problems, next step
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - planned packages
- [`docs/DECISIONS.md`](docs/DECISIONS.md) - architecture decisions
- [`docs/NETWORKING.md`](docs/NETWORKING.md), [`docs/SECURITY.md`](docs/SECURITY.md),
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) - design of the online version
- [`AGENTS.md`](AGENTS.md) - rules for coding agents working in this repository

## License

MIT - see `LICENSE`.
