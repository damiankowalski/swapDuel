# Swap Duel

An experimental **second-person shooter** (proof of concept). You steer your own fighter, but the screen shows the
world **through your opponent's eyes**: to hit, you have to learn to aim "backwards". A simple 1v1 duel on a square
arena with one indestructible crate in the middle.

The client builds to a single self-contained `index.html` (Three.js bundled). Online matches run on a small
authoritative game server (Node + WebSocket) that serves the page too; training against the bot runs entirely in the
browser. An authoritative game server is planned - see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Controls

- **W A S D** - move
- **<- ->** - turn left / right
- **Space** - throw a snowball
- **V** - toggle view (opponent's eyes <-> your own eyes)

Snowballs fly in an arc and take time to arrive, so aim ahead of a moving opponent. You start with 5 and get one
more every 10 seconds; unused ones pile up. The dashed amber arc and the reticle show where your next snowball will
land. The opponent is always at the centre of the screen (the centre is the point they look from).

## Playing online

1. One player picks **Create online game** and gets a 5-character code.
2. The other picks **Join game** and types the code.
3. Once connected, each player clicks **Click to start**.

There is also a **Training (bot)** mode for solo play; the bot throws back.

Two arenas, chosen in the menu (the host's choice counts online): **Classic** (20 x 20 m, one crate) and **Frozen
moat** (28 x 28 m, three crates and a ditch along the walls: falling in gives your opponent a point).

A match starts after a 3-2-1 countdown and ends when someone reaches **10 points**; then both players can ask for a
rematch. After being hit you respawn and blink for 1.5 s: snowballs fly through you meanwhile. The blue ring on the
ground marks your own fighter.

The server runs one match at a time; while one is running, others see "A match is in progress". Online play needs
the game server: opened from a downloaded file, only training is available.

## Playing without installing anything

Download `index.html` from the latest [release](https://github.com/damiankowalski/swapDuel/releases) and open it in
a desktop browser (Chrome, Edge, Firefox). Training works offline.

## Development

Requires Node.js 26 (see `.nvmrc`). The same commands work on macOS and Windows:

```
npm ci
npm run play       # build + game server: open two tabs at http://127.0.0.1:8080
npm test
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
