// Arena collisions and spawn points.
import { ARENA_HALF, CRATE_HALF, PLAYER_RADIUS } from './constants.ts';
import type { Vec2 } from './math.ts';
import type { Rng } from './rng.ts';

/** Keeps a fighter inside the walls and pushes it out of the crate along the shorter axis. Mutates `pos`. */
export function resolveCollisions(pos: Vec2): void {
  const limit = ARENA_HALF - PLAYER_RADIUS;
  pos.x = Math.max(-limit, Math.min(limit, pos.x));
  pos.z = Math.max(-limit, Math.min(limit, pos.z));

  const reach = CRATE_HALF + PLAYER_RADIUS;
  if (Math.abs(pos.x) < reach && Math.abs(pos.z) < reach) {
    const overlapX = reach - Math.abs(pos.x);
    const overlapZ = reach - Math.abs(pos.z);
    if (overlapX < overlapZ) pos.x = Math.sign(pos.x || 1) * reach;
    else pos.z = Math.sign(pos.z || 1) * reach;
  }
}

/** True when a fighter at `pos` is inside the walls and clear of the crate (with a small tolerance). */
export function isValidPosition(pos: Vec2, epsilon = 1e-9): boolean {
  const limit = ARENA_HALF - PLAYER_RADIUS + epsilon;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
  if (Math.abs(pos.x) > limit || Math.abs(pos.z) > limit) return false;
  const reach = CRATE_HALF + PLAYER_RADIUS - epsilon;
  return !(Math.abs(pos.x) < reach && Math.abs(pos.z) < reach);
}

/** A random point at least 1 m from the walls and the crate. */
export function randomSpawnPoint(rng: Rng): Vec2 {
  const span = ARENA_HALF - 1;
  const keepOut = CRATE_HALF + 1;
  let x: number;
  let z: number;
  do {
    x = (rng() * 2 - 1) * span;
    z = (rng() * 2 - 1) * span;
  } while (Math.abs(x) < keepOut && Math.abs(z) < keepOut);
  return { x, z };
}
