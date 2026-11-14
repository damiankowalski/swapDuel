// Headless bot-vs-bot match on the shared simulation: no rendering, no network, deterministic for a seed.
import { isValidPosition } from './arena.ts';
import { createBot, respawnBot, stepBot, type BotState } from './bot.ts';
import { SPAWN_GUEST, SPAWN_HOST } from './constants.ts';
import { seededRng } from './rng.ts';
import { createThrower, launch, pressFire, stepSnowball, tickThrower, type Snowball } from './snowball.ts';

export interface SimOptions {
  seconds: number;
  seed: number;
  /** Fixed step (s); default 1/60. */
  dt?: number;
}

export interface SimResult {
  seconds: number;
  steps: number;
  throws: [number, number];
  hits: [number, number];
  /** Snowballs still flying at the end (must stay small: they splat or melt). */
  inFlight: number;
  /** Steps where a fighter was outside the walls or inside the crate, or a stock went negative; must be 0. */
  invalid: number;
}

/** Both bots wander as in training mode and press fire once a second, throwing along their view. */
export function runMatch(options: SimOptions): SimResult {
  const dt = options.dt ?? 1 / 60;
  const rng = seededRng(options.seed);
  const bots: [BotState, BotState] = [
    createBot({ x: SPAWN_HOST.x, z: SPAWN_HOST.z }, SPAWN_HOST.yaw),
    createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw),
  ];
  const throwers = [createThrower(), createThrower()] as const;
  const balls: Snowball[] = [];
  let nextId = 1;
  const result: SimResult = { seconds: options.seconds, steps: 0, throws: [0, 0], hits: [0, 0], inFlight: 0, invalid: 0 };

  const steps = Math.round(options.seconds / dt);
  for (let step = 0; step < steps; step++) {
    const time = step * dt;
    for (const bot of bots) stepBot(bot, dt, rng);
    for (const i of [0, 1] as const) {
      const t = throwers[i];
      tickThrower(t, dt);
      const firing = Math.floor(time * 2) % 2 === 0; // pressed for half a second, released for half a second
      if (pressFire(t, firing)) {
        const s = launch(bots[i].pos, bots[i].lookYaw);
        balls.push({ id: nextId++, owner: i, pos: s.pos, vel: s.vel, age: 0 });
        result.throws[i]++;
      }
    }
    for (let j = balls.length - 1; j >= 0; j--) {
      const ball = balls[j]!;
      const victim = ball.owner === 0 ? 1 : 0;
      const impact = stepSnowball(ball, dt, [{ seat: victim, pos: bots[victim].pos }]);
      if (!impact) continue;
      balls.splice(j, 1);
      if (impact.kind === 'target') {
        result.hits[ball.owner]++;
        respawnBot(bots[victim], rng);
      }
    }
    const ok = bots.every((b) => isValidPosition(b.pos)) && throwers.every((t) => t.ammo >= 0);
    if (!ok) result.invalid++;
    result.steps++;
  }
  result.inFlight = balls.length;
  return result;
}
