// The training bot: wanders between random points and looks around at random. It does not shoot.
import { randomSpawnPoint, resolveCollisions } from './arena.ts';
import { BOT_SPEED } from './constants.ts';
import { distance2, lerpAngle, type Vec2 } from './math.ts';
import type { Rng } from './rng.ts';

export interface BotState {
  pos: Vec2;
  /** Where the bot looks (its view is the player's camera). */
  lookYaw: number;
  lookTarget: number;
  lookWait: number;
  target: Vec2;
  wait: number;
}

export function createBot(pos: Vec2, yaw: number): BotState {
  return { pos: { ...pos }, lookYaw: yaw, lookTarget: yaw, lookWait: 0, target: { ...pos }, wait: 0 };
}

const LOOK_TURN_SPEED = 1.6; // rad/s
const ARRIVED = 0.6; // m
const MIN_STEP_SQ = 0.04; // m^2; closer than 0.2 m the bot stops

export function stepBot(bot: BotState, dt: number, rng: Rng): void {
  bot.wait -= dt;
  if (distance2(bot.pos, bot.target) < ARRIVED || bot.wait <= 0) {
    bot.target = randomSpawnPoint(rng);
    bot.wait = 2 + rng() * 3;
  }

  const dx = bot.target.x - bot.pos.x;
  const dz = bot.target.z - bot.pos.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq > MIN_STEP_SQ) {
    const step = (BOT_SPEED * dt) / Math.sqrt(lenSq);
    bot.pos.x += dx * step;
    bot.pos.z += dz * step;
    resolveCollisions(bot.pos);
  }

  bot.lookWait -= dt;
  if (bot.lookWait <= 0) {
    bot.lookTarget = (rng() * 2 - 1) * Math.PI;
    bot.lookWait = 1.2 + rng() * 2.5;
  }
  bot.lookYaw = lerpAngle(bot.lookYaw, bot.lookTarget, LOOK_TURN_SPEED * dt);
}

/** After being hit: a new random position and a new walking target. */
export function respawnBot(bot: BotState, rng: Rng): void {
  bot.pos = randomSpawnPoint(rng);
  bot.target = randomSpawnPoint(rng);
}
