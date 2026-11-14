// Small vector and angle helpers. Positions live on the ground plane (x, z); y is up.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const TWO_PI = Math.PI * 2;

/** Wraps an angle difference into [-PI, PI]. */
export function wrapAngle(angle: number): number {
  let d = angle;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Turns `current` towards `target` by at most `maxStep` radians, the short way round. */
export function lerpAngle(current: number, target: number, maxStep: number): number {
  const d = wrapAngle(target - current);
  return current + Math.max(-maxStep, Math.min(maxStep, d));
}

/** Moves `current` a fraction `t` (clamped to 1) of the way to `target`, the short way round. */
export function approachAngle(current: number, target: number, t: number): number {
  return current + wrapAngle(target - current) * Math.min(1, t);
}

/** Unit vector a fighter faces on the ground plane; yaw 0 faces -z, positive yaw turns left. */
export function forwardOf(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Unit vector to the fighter's right on the ground plane. */
export function rightOf(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/** Unit aim direction for a yaw and pitch (Euler order YXZ, as in the renderer). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -c * Math.sin(yaw), y: Math.sin(pitch), z: -c * Math.cos(yaw) };
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Moves `from` towards `to` by a fraction `t` (not clamped), in place. */
export function lerpInPlace(from: Vec2, to: Vec2, t: number): void {
  from.x += (to.x - from.x) * t;
  from.z += (to.z - from.z) * t;
}
