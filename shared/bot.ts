// The training bot: wanders between random points and looks around. Given a target, it sometimes turns towards it
// (with an aiming error) and reports when it is lined up to throw; the caller applies the throwing rules.
import { randomSpawnPoint, resolveCollisions } from './arena.ts';
import { BOT_SPEED, BOT_THROW_RANGE } from './constants.ts';
import { distance2, lerpAngle, wrapAngle, type Vec2 } from './math.ts';
import type { Rng } from './rng.ts';

export interface BotState {
  pos: Vec2;
  /** Where the bot looks (its view is the player's camera). */
  lookYaw: number;
  lookTarget: number;
  lookWait: number;
  target: Vec2;
  wait: number;
  /** Turning towards the target (true) or looking around (false). */
  aiming: boolean;
  /** Aiming error for the current aim (rad): the bot is beatable. */
  aimError: number;
}

export function createBot(pos: Vec2, yaw: number): BotState {
  return {
    pos: { ...pos }, lookYaw: yaw, lookTarget: yaw, lookWait: 0, target: { ...pos }, wait: 0, aiming: false, aimError: 0,
  };
}

/** Yaw that faces from `from` towards `to` (yaw 0 faces -z). */
export function yawTowards(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** Chance that a new look is an aim at the target; how far off an aim can be (rad); "lined up" tolerance (rad). */
const AIM_CHANCE = 0.6;
const MAX_AIM_ERROR = 0.15;
const LINED_UP = 0.05;

const LOOK_TURN_SPEED = 1.6; // rad/s
const ARRIVED = 0.6; // m
const MIN_STEP_SQ = 0.04; // m^2; closer than 0.2 m the bot stops

/**
 * Advances the bot by `dt`. With a `foe`, it sometimes aims at it; returns true while it is lined up within throwing
 * range (feed this to `pressFire`: one throw per aim, since a throw needs a new press).
 */
export function stepBot(bot: BotState, dt: number, rng: Rng, foe?: Vec2): boolean {
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
    if (foe && rng() < AIM_CHANCE) {
      bot.aiming = true;
      bot.aimError = (rng() * 2 - 1) * MAX_AIM_ERROR;
      bot.lookWait = 1.5 + rng() * 1.5;
    } else {
      bot.aiming = false;
      bot.lookTarget = (rng() * 2 - 1) * Math.PI;
      bot.lookWait = 1.2 + rng() * 2.5;
    }
  }
  if (bot.aiming && foe) bot.lookTarget = yawTowards(bot.pos, foe) + bot.aimError;
  bot.lookYaw = lerpAngle(bot.lookYaw, bot.lookTarget, LOOK_TURN_SPEED * dt);
  return (
    bot.aiming &&
    foe !== undefined &&
    Math.abs(wrapAngle(bot.lookTarget - bot.lookYaw)) < LINED_UP &&
    distance2(bot.pos, foe) < BOT_THROW_RANGE
  );
}

/** After being hit: a new random position and a new walking target. */
export function respawnBot(bot: BotState, rng: Rng): void {
  bot.pos = randomSpawnPoint(rng);
  bot.target = randomSpawnPoint(rng);
}
