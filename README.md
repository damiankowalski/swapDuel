# Swap Duel

An experimental **second-person shooter** (proof of concept). You steer your own fighter, but the screen shows the
world **through your opponent's eyes**: to hit, you have to learn to aim "backwards". A simple 1v1 duel on a square
arena with one indestructible crate in the middle.

The game builds to a single self-contained `index.html` (Three.js and PeerJS bundled). No server of its own yet:
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

1. One player picks **Create online game** and gets a 5-character code.
2. The other picks **Join game** and types the code.
3. Once connected, each player clicks **Click to start**.

There is also a **Training (bot)** mode for solo play.

> Note: on some home networks a plain P2P (WebRTC) connection cannot be set up without a TURN server. If it hangs on
> "connecting", that is the most likely cause. The planned game server removes this problem.

## Playing without installing anything

Download `index.html` from the latest [release](https://github.com/damiankowalski/swapDuel/releases) and open it in
a desktop browser (Chrome, Edge, Firefox). Training works offline; online play needs internet.

## Development

Requires Node.js 26 (see `.nvmrc`). The same commands work on macOS and Windows:

```
npm ci
npm run dev        # http://127.0.0.1:5173
npm test
npm run build      # dist/index.html
```

All commands are listed in [`AGENTS.md`](AGENTS.md#commands).

## Project docs

- [`docs/STATUS.md`](docs/STATUS.md) - what works, known problems, next step
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - planned packages
- [`docs/DECISIONS.md`](docs/DECISIONS.md) - architecture decisions
- [`docs/NETWORKING.md`](docs/NETWORKING.md), [`docs/SECURITY.md`](docs/SECURITY.md),
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) - design of the online version
- [`AGENTS.md`](AGENTS.md) - rules for coding agents working in this repository

## License

MIT - see `LICENSE`.
