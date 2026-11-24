// Movement of a human-controlled fighter.
import { resolveCollisions } from './arena.ts';
import { DEFAULT_MAP, type ArenaMap } from './maps.ts';
import { EYE_HEIGHT, MOVE_SPEED, TURN_SPEED } from './constants.ts';
import { forwardOf, rightOf, type Vec2, type Vec3 } from './math.ts';

/** The point a fighter at `pos` looks from. */
export function eyeOf(pos: Vec2): Vec3 {
  return { x: pos.x, y: EYE_HEIGHT, z: pos.z };
}

export interface PlayerState {
  pos: Vec2;
  yaw: number;
  /** Always 0 for now (no mouse aim yet); kept so shots already use it. */
  pitch: number;
}

export interface MoveInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  turnLeft: boolean;
  turnRight: boolean;
}

export const NO_INPUT: Readonly<MoveInput> = {
  forward: false,
  back: false,
  left: false,
  right: false,
  turnLeft: false,
  turnRight: false,
};

/** Advances a fighter by `dt` seconds: turn first, then move along the new heading, then collide. */
export function stepPlayer(player: PlayerState, input: MoveInput, dt: number, map: ArenaMap = DEFAULT_MAP): void {
  if (input.turnLeft) player.yaw += TURN_SPEED * dt;
  if (input.turnRight) player.yaw -= TURN_SPEED * dt;

  const fwd = forwardOf(player.yaw);
  const right = rightOf(player.yaw);
  let mx = 0;
  let mz = 0;
  if (input.forward) { mx += fwd.x; mz += fwd.z; }
  if (input.back) { mx -= fwd.x; mz -= fwd.z; }
  if (input.right) { mx += right.x; mz += right.z; }
  if (input.left) { mx -= right.x; mz -= right.z; }

  const len = Math.hypot(mx, mz);
  if (len > 0) {
    const step = (MOVE_SPEED * dt) / len;
    player.pos.x += mx * step;
    player.pos.z += mz * step;
    resolveCollisions(player.pos, map);
  }
}
