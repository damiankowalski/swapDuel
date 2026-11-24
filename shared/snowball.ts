// Snowballs: ballistic projectiles with gravity, an ammo stock that refills over time, and collisions with the
// arena and the fighters. Pure functions shared by the server, client prediction, training mode and tests.
import {
  AMMO_INTERVAL,
  BODY_RADIUS,
  BODY_SEGMENT_BOTTOM,
  BODY_SEGMENT_TOP,
  GRAVITY,
  HEAD_CENTER_Y,
  HEAD_RADIUS,
  MAX_AMMO,
  SNOWBALL_ELEVATION,
  SNOWBALL_LIFETIME,
  SNOWBALL_RADIUS,
  SNOWBALL_SPEED,
  SNOWBALL_STEP,
  START_AMMO,
  THROW_COOLDOWN,
  THROW_FORWARD,
  THROW_HEIGHT,
  WALL_THICKNESS,
} from './constants.ts';
import { DEFAULT_MAP, ditchEdge, type ArenaMap } from './maps.ts';
import { forwardOf, type Vec2, type Vec3 } from './math.ts';

// ---------- Ammo and throwing ----------

/** A player's snowball stock and throwing state. */
export interface Thrower {
  ammo: number;
  /** Seconds collected towards the next snowball. */
  regen: number;
  cooldown: number;
  /** Whether fire was held at the previous input: a throw needs a new press. */
  wasFiring: boolean;
}

export function createThrower(): Thrower {
  return { ammo: START_AMMO, regen: 0, cooldown: 0, wasFiring: false };
}

/** Time passes: the cooldown runs down and the stock refills by one every AMMO_INTERVAL. */
export function tickThrower(t: Thrower, dt: number, maxAmmo = MAX_AMMO): void {
  t.cooldown = Math.max(0, t.cooldown - dt);
  if (t.ammo >= maxAmmo) {
    t.regen = 0;
    return;
  }
  t.regen += dt;
  while (t.regen >= AMMO_INTERVAL && t.ammo < maxAmmo) {
    t.regen -= AMMO_INTERVAL;
    t.ammo++;
  }
}

/** The fire key's state at one input. Returns true when this press throws a snowball (and takes it from the stock). */
export function pressFire(t: Thrower, firing: boolean): boolean {
  const pressed = firing && !t.wasFiring;
  t.wasFiring = firing;
  if (!pressed || t.ammo <= 0 || t.cooldown > 0) return false;
  t.ammo--;
  t.cooldown = THROW_COOLDOWN;
  return true;
}

/** Seconds until the next snowball arrives (0 at the cap). */
export function secondsToNextSnowball(t: Thrower, maxAmmo = MAX_AMMO): number {
  return t.ammo >= maxAmmo ? 0 : AMMO_INTERVAL - t.regen;
}

// ---------- Flight ----------

export interface Snowball {
  id: number;
  owner: 0 | 1;
  pos: Vec3;
  vel: Vec3;
  age: number;
}

/** Start position and velocity of a snowball thrown by a fighter at `pos` facing `yaw`. */
export function launch(pos: Vec2, yaw: number): { pos: Vec3; vel: Vec3 } {
  const f = forwardOf(yaw);
  const h = Math.cos(SNOWBALL_ELEVATION) * SNOWBALL_SPEED;
  return {
    pos: { x: pos.x + f.x * THROW_FORWARD, y: THROW_HEIGHT, z: pos.z + f.z * THROW_FORWARD },
    vel: { x: f.x * h, y: Math.sin(SNOWBALL_ELEVATION) * SNOWBALL_SPEED, z: f.z * h },
  };
}

/** Where a snowball is `t` seconds after leaving `pos` with velocity `vel` (no collisions). */
export function positionAt(pos: Vec3, vel: Vec3, t: number): Vec3 {
  return { x: pos.x + vel.x * t, y: pos.y + vel.y * t - 0.5 * GRAVITY * t * t, z: pos.z + vel.z * t };
}

export interface Target {
  seat: 0 | 1;
  pos: Vec2;
}

export type Impact = { kind: 'world'; point: Vec3 } | { kind: 'target'; seat: 0 | 1; point: Vec3 } | null;

/** True when a ball at `p` touches the floor (lower over the ditch), a wall or a crate. */
export function hitsWorld(p: Vec3, map: ArenaMap = DEFAULT_MAP, r = SNOWBALL_RADIUS): boolean {
  const overDitch = map.ditch > 0 && (Math.abs(p.x) > ditchEdge(map) || Math.abs(p.z) > ditchEdge(map));
  if (p.y <= (overDitch ? -map.ditchDepth : 0) + r) return true;
  const wallInner = map.half - WALL_THICKNESS / 2;
  if (p.y <= map.wallHeight + r && (Math.abs(p.x) >= wallInner - r || Math.abs(p.z) >= wallInner - r)) return true;
  for (const c of map.crates) {
    const cx = Math.max(c.x - c.half, Math.min(c.x + c.half, p.x));
    const cy = Math.max(0, Math.min(c.height, p.y));
    const cz = Math.max(c.z - c.half, Math.min(c.z + c.half, p.z));
    if ((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 <= r * r) return true;
  }
  return false;
}

/** True when a ball at `p` touches the body (capsule) or head (sphere) of a fighter standing at `at`. */
export function hitsFighter(p: Vec3, at: Vec2, r = SNOWBALL_RADIUS): boolean {
  const y = Math.max(BODY_SEGMENT_BOTTOM, Math.min(BODY_SEGMENT_TOP, p.y));
  const body = (p.x - at.x) ** 2 + (p.y - y) ** 2 + (p.z - at.z) ** 2;
  if (body <= (BODY_RADIUS + r) ** 2) return true;
  const head = (p.x - at.x) ** 2 + (p.y - HEAD_CENTER_Y) ** 2 + (p.z - at.z) ** 2;
  return head <= (HEAD_RADIUS + r) ** 2;
}

/**
 * Advances a snowball by `dt` in small physics steps. Returns the first impact (a fighter in `targets`, or the
 * world), or null while it is still flying. A ball past SNOWBALL_LIFETIME counts as a world impact.
 */
export function stepSnowball(
  ball: Snowball,
  dt: number,
  targets: readonly Target[],
  map: ArenaMap = DEFAULT_MAP,
): Impact {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(SNOWBALL_STEP, left);
    left -= h;
    ball.pos.x += ball.vel.x * h;
    ball.pos.y += ball.vel.y * h - 0.5 * GRAVITY * h * h;
    ball.pos.z += ball.vel.z * h;
    ball.vel.y -= GRAVITY * h;
    ball.age += h;
    for (const t of targets) {
      if (hitsFighter(ball.pos, t.pos)) return { kind: 'target', seat: t.seat, point: { ...ball.pos } };
    }
    if (hitsWorld(ball.pos, map) || ball.age >= SNOWBALL_LIFETIME) return { kind: 'world', point: { ...ball.pos } };
  }
  return null;
}

/** Where a snowball thrown now would land (floor, wall or crate), for the reticle. */
export function landingPoint(pos: Vec2, yaw: number, map: ArenaMap = DEFAULT_MAP): Vec3 {
  const start = launch(pos, yaw);
  const ball: Snowball = { id: 0, owner: 0, pos: start.pos, vel: start.vel, age: 0 };
  for (let i = 0; i < 1000; i++) {
    const impact = stepSnowball(ball, 1 / 120, [], map);
    if (impact) return impact.point;
  }
  return ball.pos;
}
