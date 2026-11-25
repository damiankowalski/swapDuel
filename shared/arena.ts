// Arena collisions, the ditch and spawn points, for any arena (shared/maps.ts).
import { PLAYER_RADIUS } from './constants.ts';
import { DEFAULT_MAP, ditchEdge, type ArenaMap } from './maps.ts';
import type { Vec2 } from './math.ts';
import type { Rng } from './rng.ts';

/** A fighter whose centre passes the ditch's edge by this much (m) falls in. */
export const FALL_MARGIN = 0.3;

/** Keeps a fighter inside the walls and pushes it out of every crate along the shorter axis. Mutates `pos`. */
export function resolveCollisions(pos: Vec2, map: ArenaMap = DEFAULT_MAP): void {
  const limit = map.half - PLAYER_RADIUS;
  pos.x = Math.max(-limit, Math.min(limit, pos.x));
  pos.z = Math.max(-limit, Math.min(limit, pos.z));

  for (const c of map.crates) {
    const reach = c.half + PLAYER_RADIUS;
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    if (Math.abs(dx) < reach && Math.abs(dz) < reach) {
      const overlapX = reach - Math.abs(dx);
      const overlapZ = reach - Math.abs(dz);
      if (overlapX < overlapZ) pos.x = c.x + Math.sign(dx || 1) * reach;
      else pos.z = c.z + Math.sign(dz || 1) * reach;
    }
  }
}

/** True when a fighter at `pos` has fallen into the ditch (always false on an arena without one). */
export function inDitch(pos: Vec2, map: ArenaMap = DEFAULT_MAP): boolean {
  if (map.ditch <= 0) return false;
  const edge = ditchEdge(map) + FALL_MARGIN;
  return Math.abs(pos.x) > edge || Math.abs(pos.z) > edge;
}

/** True when a fighter at `pos` is inside the walls, clear of every crate and not in the ditch (small tolerance). */
export function isValidPosition(pos: Vec2, map: ArenaMap = DEFAULT_MAP, epsilon = 1e-9): boolean {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
  const limit = map.half - PLAYER_RADIUS + epsilon;
  if (Math.abs(pos.x) > limit || Math.abs(pos.z) > limit) return false;
  if (inDitch(pos, map)) return false;
  for (const c of map.crates) {
    const reach = c.half + PLAYER_RADIUS - epsilon;
    if (Math.abs(pos.x - c.x) < reach && Math.abs(pos.z - c.z) < reach) return false;
  }
  return true;
}

/** A random point at least 1 m from the walls (or the ditch) and from every crate. */
export function randomSpawnPoint(rng: Rng, map: ArenaMap = DEFAULT_MAP): Vec2 {
  const span = (map.ditch > 0 ? ditchEdge(map) : map.half) - 1;
  let x: number;
  let z: number;
  do {
    x = (rng() * 2 - 1) * span;
    z = (rng() * 2 - 1) * span;
  } while (map.crates.some((c) => Math.abs(x - c.x) < c.half + 1 && Math.abs(z - c.z) < c.half + 1));
  return { x, z };
}
