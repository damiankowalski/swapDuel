// Hit-scan shots: a ray from the shooter's eye against the crate and the opponent's hit shape.
import {
  BODY_RADIUS,
  BODY_SEGMENT_BOTTOM,
  BODY_SEGMENT_TOP,
  CRATE_HALF,
  CRATE_HEIGHT,
  EYE_HEIGHT,
  HEAD_CENTER_Y,
  HEAD_RADIUS,
  MUZZLE_OFFSET,
  SHOT_RANGE,
} from './constants.ts';
import type { Vec2, Vec3 } from './math.ts';

export type ShotHit = 'target' | 'crate' | null;

export interface ShotResult {
  hit: ShotHit;
  /** Where the tracer ends: the hit point, or SHOT_RANGE metres along the ray. */
  point: Vec3;
}

export function eyeOf(pos: Vec2): Vec3 {
  return { x: pos.x, y: EYE_HEIGHT, z: pos.z };
}

/** World position of the muzzle of a fighter at `pos` facing `yaw` (tracers start here). */
export function muzzleOf(pos: Vec2, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return {
    x: pos.x + MUZZLE_OFFSET.x * c + MUZZLE_OFFSET.z * s,
    y: MUZZLE_OFFSET.y,
    z: pos.z - MUZZLE_OFFSET.x * s + MUZZLE_OFFSET.z * c,
  };
}

/**
 * Casts a shot from `origin` along the unit vector `dir`. The nearest of the crate and the fighter standing at
 * `target` (if any) wins. Only surfaces the ray enters count: a ray starting inside a shape does not hit it.
 */
export function castShot(origin: Vec3, dir: Vec3, target: Vec2 | null): ShotResult {
  let best = Infinity;
  let hit: ShotHit = null;

  const tCrate = rayAabb(origin, dir, -CRATE_HALF, 0, -CRATE_HALF, CRATE_HALF, CRATE_HEIGHT, CRATE_HALF);
  if (tCrate < best) { best = tCrate; hit = 'crate'; }

  if (target) {
    const tBody = rayVerticalCapsule(origin, dir, target.x, target.z, BODY_SEGMENT_BOTTOM, BODY_SEGMENT_TOP, BODY_RADIUS);
    const tHead = raySphere(origin, dir, { x: target.x, y: HEAD_CENTER_Y, z: target.z }, HEAD_RADIUS);
    const tTarget = Math.min(tBody, tHead);
    if (tTarget < best) { best = tTarget; hit = 'target'; }
  }

  const t = hit ? best : SHOT_RANGE;
  return { hit, point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t } };
}

/** Distance along the ray to where it enters the sphere, or Infinity. */
export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  if (cc <= 0) return Infinity; // starts inside
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Distance to where the ray enters a vertical capsule (segment y0..y1 at x, z; radius r), or Infinity. */
export function rayVerticalCapsule(o: Vec3, d: Vec3, x: number, z: number, y0: number, y1: number, r: number): number {
  let best = Infinity;
  // Side of the cylinder between y0 and y1.
  const ox = o.x - x;
  const oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  const insideCylinder = ox * ox + oz * oz <= r * r;
  if (a > 1e-12 && !insideCylinder) {
    const b = ox * d.x + oz * d.z;
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = o.y + d.y * t;
      if (t >= 0 && y >= y0 && y <= y1) best = t;
    }
  }
  // The two end caps (half spheres); the nearest entry point counts.
  if (!(insideCylinder && o.y >= y0 && o.y <= y1)) {
    best = Math.min(best, capEntry(o, d, { x, y: y0, z }, r, -1, y0), capEntry(o, d, { x, y: y1, z }, r, 1, y1));
  }
  return best;
}

function capEntry(o: Vec3, d: Vec3, c: Vec3, r: number, side: -1 | 1, yLimit: number): number {
  const t = raySphere(o, d, c, r);
  if (t === Infinity) return t;
  const y = o.y + d.y * t;
  return side === 1 ? (y >= yLimit ? t : Infinity) : (y <= yLimit ? t : Infinity);
}

/** Distance to where the ray enters an axis-aligned box, or Infinity (also when it starts inside). */
export function rayAabb(
  o: Vec3, d: Vec3,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  let tNear = -Infinity;
  let tFar = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [o.x, d.x, minX, maxX],
    [o.y, d.y, minY, maxY],
    [o.z, d.z, minZ, maxZ],
  ];
  for (const [oa, da, lo, hi] of axes) {
    if (Math.abs(da) < 1e-12) {
      if (oa < lo || oa > hi) return Infinity;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tNear = Math.max(tNear, t1);
    tFar = Math.min(tFar, t2);
    if (tNear > tFar) return Infinity;
  }
  return tNear >= 0 ? tNear : Infinity;
}
