// Animation curves for the snowmen and effects. Pure functions of time (no Three.js, no DOM), so they are tested
// headless (anim.test.ts) and the renderer only applies the numbers.

/** How long each one-shot animation runs (s). */
export const THROW_ANIM = 0.32;
export const POP_ANIM = 0.45;
export const SINK_ANIM = 0.7;
export const BURST_ANIM = 0.55;
/** A fighter that moves further than this in one frame was respawned (teleported), not walking. */
export const TELEPORT_DISTANCE = 1.5;
/** Stride length: one full waddle cycle per this many metres walked. */
export const STRIDE = 1.1;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Walking waddle at stride `phase` (radians) with `amount` 0..1 (0 = standing): a side-to-side roll, a small hop
 * and the arms swinging against each other.
 */
export function waddle(phase: number, amount: number): { roll: number; hop: number; arm: number } {
  const a = clamp01(amount);
  return { roll: Math.sin(phase) * 0.14 * a, hop: Math.abs(Math.sin(phase)) * 0.06 * a, arm: Math.sin(phase) * 0.5 * a };
}

/**
 * Throwing arm angle (radians around the shoulder, 0 = hanging down, positive = raised forward) `t` seconds after a
 * throw: wind up behind the head, whip forward, settle. 0 before and after the animation.
 */
export function throwArm(t: number): number {
  if (t < 0 || t >= THROW_ANIM) return 0;
  const k = t / THROW_ANIM;
  if (k < 0.3) return -2.6 * (k / 0.3); // wind up: arm goes back over the shoulder
  if (k < 0.55) return -2.6 + 4.4 * ((k - 0.3) / 0.25); // whip forward to +1.8
  return 1.8 * (1 - (k - 0.55) / 0.45); // settle back down
}

/** Scale of a fighter popping back in after a respawn: grows from small with a little overshoot, then 1. */
export function popScale(t: number): number {
  if (t < 0) return 0.2;
  if (t >= POP_ANIM) return 1;
  const k = t / POP_ANIM;
  // easeOutBack
  const c = 1.9;
  const x = k - 1;
  return 0.2 + 0.8 * (1 + (c + 1) * x * x * x + c * x * x);
}

/** A fighter falling into the ditch: how far it has sunk (m, positive = down) and its remaining scale. */
export function sink(t: number): { drop: number; scale: number } {
  const k = clamp01(t / SINK_ANIM);
  return { drop: 2.2 * k * k, scale: 1 - 0.6 * k };
}

/** A snow burst particle's remaining size, 1 at the start down to 0. */
export function burstFade(t: number): number {
  return 1 - clamp01(t / BURST_ANIM);
}

/** True when a move from (x0,z0) to (x1,z1) within one frame is a respawn rather than walking. */
export function isTeleport(x0: number, z0: number, x1: number, z1: number): boolean {
  return Math.hypot(x1 - x0, z1 - z0) > TELEPORT_DISTANCE;
}

/** Volume (0..1) of a sound `distance` metres from the listener. */
export function distanceGain(distance: number): number {
  return 1 / (1 + Math.max(0, distance) / 6);
}
