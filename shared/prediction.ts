// Client-side prediction and reconciliation of the local fighter (docs/NETWORKING.md §7).
import { DEFAULT_MAP, type ArenaMap } from './maps.ts';
import { applyInput } from './netsim.ts';
import type { PlayerState } from './player.ts';
import { MAX_SEQ, type Pose } from './protocol.ts';
import { wrapAngle } from './math.ts';

/** Corrections larger than this (m) snap instead of being smoothed. */
export const SNAP_DISTANCE = 1;
/** Time constant of the smoothing of small corrections (s). */
export const CORRECTION_TAU = 0.1;
/** Unacknowledged inputs kept for replay; older ones are dropped. */
const MAX_PENDING = 120;

export interface PendingInput {
  s: number;
  k: number;
}

function clone(p: PlayerState): PlayerState {
  return { pos: { x: p.pos.x, z: p.pos.z }, yaw: p.yaw, pitch: p.pitch };
}

export class Predictor {
  /** Predicted state after the latest local tick. */
  state: PlayerState;
  /** State one tick earlier, for smooth rendering between ticks. */
  private prev: PlayerState;
  private pending: PendingInput[] = [];
  private nextSeq = 0;
  private offset = { x: 0, z: 0 };
  corrections = 0;
  lastCorrection = 0;

  private readonly map: ArenaMap;

  constructor(start: Pose, map: ArenaMap = DEFAULT_MAP) {
    this.map = map;
    this.state = { pos: { x: start.x, z: start.z }, yaw: start.yaw, pitch: 0 };
    this.prev = clone(this.state);
  }

  /** Runs one local tick with the given keys and returns the input to send to the server. */
  step(keys: number): PendingInput {
    const input = { s: this.nextSeq, k: keys };
    this.nextSeq = this.nextSeq >= MAX_SEQ ? 0 : this.nextSeq + 1;
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.prev = clone(this.state);
    applyInput(this.state, keys, undefined, this.map);
    return input;
  }

  /** Applies the server's authoritative state for the input `ack` and replays the inputs after it. */
  reconcile(ack: number, server: Pose): number {
    while (this.pending.length > 0 && this.pending[0]!.s <= ack) this.pending.shift();
    const replayed: PlayerState = { pos: { x: server.x, z: server.z }, yaw: server.yaw, pitch: 0 };
    for (const input of this.pending) applyInput(replayed, input.k, undefined, this.map);

    const dx = this.state.pos.x - replayed.pos.x;
    const dz = this.state.pos.z - replayed.pos.z;
    const error = Math.hypot(dx, dz);
    if (error > 1e-6) {
      this.corrections++;
      this.lastCorrection = error;
    }
    if (error > SNAP_DISTANCE) {
      this.offset = { x: 0, z: 0 };
      this.prev = clone(replayed);
    } else {
      // Keep what is on screen where it is and let the difference fade out.
      this.offset.x += dx;
      this.offset.z += dz;
      this.prev.pos.x -= dx;
      this.prev.pos.z -= dz;
    }
    this.prev.yaw += wrapAngle(replayed.yaw - this.state.yaw);
    this.state = replayed;
    return error;
  }

  /** Pose to draw: between the last two ticks (`alpha` 0..1) plus the fading correction. */
  render(alpha: number, frameDt: number): Pose {
    const decay = Math.exp(-frameDt / CORRECTION_TAU);
    this.offset.x *= decay;
    this.offset.z *= decay;
    const a = Math.max(0, Math.min(1, alpha));
    return {
      x: this.prev.pos.x + (this.state.pos.x - this.prev.pos.x) * a + this.offset.x,
      z: this.prev.pos.z + (this.state.pos.z - this.prev.pos.z) * a + this.offset.z,
      yaw: this.prev.yaw + wrapAngle(this.state.yaw - this.prev.yaw) * a,
    };
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
