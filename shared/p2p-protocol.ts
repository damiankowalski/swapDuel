// Messages of the v0.1.0 peer-to-peer online mode (PeerJS). Temporary: replaced by the server protocol in P2.
import { ARENA_HALF, SHOT_RANGE } from './constants.ts';

/** Own position and yaw, about 30 times a second. */
export interface StateMessage { t: 's'; x: number; z: number; y: number }
/** A tracer to draw: muzzle (o) to end point (e). */
export interface ShotMessage { t: 'shot'; ox: number; oy: number; oz: number; ex: number; ey: number; ez: number }
/** "I hit you": the receiver scores a point for the sender and respawns. */
export interface HitMessage { t: 'hit' }

export type PeerMessage = StateMessage | ShotMessage | HitMessage;

const MAX_POSITION = ARENA_HALF + 1;
const MAX_POINT = ARENA_HALF + SHOT_RANGE + 1;
/** Yaw is not wrapped while playing; any finite value up to this size is accepted. */
const MAX_YAW = 1e6;

function num(v: unknown, limit: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
}

/** Returns the message if it is well formed, otherwise null (the caller ignores it). */
export function parsePeerMessage(raw: unknown): PeerMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m['t']) {
    case 's':
      return num(m['x'], MAX_POSITION) && num(m['z'], MAX_POSITION) && num(m['y'], MAX_YAW)
        ? { t: 's', x: m['x'], z: m['z'], y: m['y'] }
        : null;
    case 'shot': {
      const keys = ['ox', 'oy', 'oz', 'ex', 'ey', 'ez'] as const;
      if (!keys.every((k) => num(m[k], MAX_POINT))) return null;
      const v = m as Record<(typeof keys)[number], number>;
      return { t: 'shot', ox: v.ox, oy: v.oy, oz: v.oz, ex: v.ex, ey: v.ey, ez: v.ez };
    }
    case 'hit':
      return { t: 'hit' };
    default:
      return null;
  }
}
