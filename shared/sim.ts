// Headless bot-vs-bot match on the shared simulation: no rendering, no network, deterministic for a seed.
import { isValidPosition } from './arena.ts';
import { createBot, respawnBot, stepBot, type BotState } from './bot.ts';
import { FIRE_INTERVAL, HIT_COOLDOWN, SPAWN_GUEST, SPAWN_HOST } from './constants.ts';
import { aimDirection } from './math.ts';
import { seededRng } from './rng.ts';
import { castShot, eyeOf } from './shot.ts';

export interface SimOptions {
  seconds: number;
  seed: number;
  /** Fixed step (s); default 1/60. */
  dt?: number;
}

export interface SimResult {
  seconds: number;
  steps: number;
  shots: [number, number];
  hits: [number, number];
  /** Steps where a fighter was outside the walls or inside the crate; must be 0. */
  invalidPositions: number;
}

/** Both bots wander as in training mode and fire every FIRE_INTERVAL along their view. */
export function runMatch(options: SimOptions): SimResult {
  const dt = options.dt ?? 1 / 60;
  const rng = seededRng(options.seed);
  const bots: [BotState, BotState] = [
    createBot({ x: SPAWN_HOST.x, z: SPAWN_HOST.z }, SPAWN_HOST.yaw),
    createBot({ x: SPAWN_GUEST.x, z: SPAWN_GUEST.z }, SPAWN_GUEST.yaw),
  ];
  const fireCd = [0, 0];
  const hitCd = [0, 0];
  const result: SimResult = { seconds: options.seconds, steps: 0, shots: [0, 0], hits: [0, 0], invalidPositions: 0 };

  const steps = Math.round(options.seconds / dt);
  for (let step = 0; step < steps; step++) {
    for (const bot of bots) stepBot(bot, dt, rng);
    for (const i of [0, 1] as const) {
      const shooter = bots[i];
      const victim = bots[i === 0 ? 1 : 0];
      hitCd[i]! -= dt;
      fireCd[i]! -= dt;
      if (fireCd[i]! > 0) continue;
      fireCd[i] = FIRE_INTERVAL;
      result.shots[i]++;
      const shot = castShot(eyeOf(shooter.pos), aimDirection(shooter.lookYaw, 0), victim.pos);
      if (shot.hit === 'target' && hitCd[i]! <= 0) {
        hitCd[i] = HIT_COOLDOWN;
        result.hits[i]++;
        respawnBot(victim, rng);
      }
    }
    if (!isValidPosition(bots[0].pos) || !isValidPosition(bots[1].pos)) result.invalidPositions++;
    result.steps++;
  }
  return result;
}
