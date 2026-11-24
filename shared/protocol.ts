// Client <-> server protocol (docs/NETWORKING.md). JSON text frames with short keys.
// Both sides validate everything they receive; the server closes the socket on any invalid message.
import { AMMO_INTERVAL, ARENA_HALF, SNOWBALL_SPEED } from './constants.ts';

/** Bump on every incompatible change; client and server come from the same build. v2: snowballs; v3: match rules. */
export const PROTOCOL_VERSION = 3;
export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;
/** Largest frame the server accepts (bytes). */
export const MAX_MESSAGE_BYTES = 1024;

// ---------- Input keys (bitmask) ----------
export const KEY_FORWARD = 1;
export const KEY_BACK = 2;
export const KEY_LEFT = 4;
export const KEY_RIGHT = 8;
export const KEY_TURN_LEFT = 16;
export const KEY_TURN_RIGHT = 32;
export const KEY_FIRE = 64;
export const KEY_MASK = 127;
export const MAX_SEQ = 0xffffffff;

// ---------- Shared shapes ----------
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

export type Who = 'you' | 'opp';

export type Vec3Tuple = [number, number, number];

export type GameEvent =
  /** A snowball left `by`'s hand this tick at `from` with velocity `vel`. */
  | { k: 'throw'; by: Who; id: number; from: Vec3Tuple; vel: Vec3Tuple }
  /** Snowball `id` hit something and is gone. */
  | { k: 'splat'; id: number; at: Vec3Tuple }
  | { k: 'hit'; by: Who }
  | { k: 'spawn'; who: Who; x: number; z: number };

export type RejectReason = 'version' | 'busy' | 'full' | 'bad_code' | 'timeout' | 'protocol';
export type EndReason = 'opponent_left' | 'time_limit' | 'idle' | 'room_expired' | 'server_shutdown';

// ---------- Client -> server ----------
export type ClientMessage =
  | { t: 'hello'; v: number }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'in'; s: number; k: number }
  /** After a finished match: I want to play again. */
  | { t: 'rematch' }
  | { t: 'leave' };

// ---------- Server -> client ----------
export type ServerMessage =
  | { t: 'welcome'; v: number; hz: number }
  | { t: 'reject'; reason: RejectReason }
  | { t: 'room'; code: string; seat: 0 | 1 }
  /** A match (or a rematch) starts; nobody can move or throw for `go` seconds (the countdown). */
  | { t: 'start'; tick: number; you: Pose; opp: Pose; go: number }
  /** Someone reached WIN_SCORE. The room stays open for a rematch. */
  | { t: 'over'; score: [number, number]; winner: Who }
  /** The opponent asked for a rematch. */
  | { t: 'rematch' }
  | {
      t: 'snap';
      tick: number;
      ack: number;
      you: Pose;
      opp: Pose;
      score: [number, number];
      /** Your snowballs, and seconds until the next one arrives. */
      ammo: number;
      next: number;
      ev: GameEvent[];
    }
  | { t: 'end'; reason: EndReason };

const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;
/** Room code alphabet without look-alikes (no I, L, O, 0, 1). */
export const SERVER_ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isRoomCode(v: unknown): v is string {
  return typeof v === 'string' && CODE_RE.test(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function isNum(v: unknown, limit: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit;
}

function onlyKeys(m: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const k of Object.keys(m)) if (!allowed.includes(k)) return false;
  return true;
}

/** Parses one text frame from a client. Returns null for anything that is not exactly a valid message. */
export function parseClientMessage(text: string): ClientMessage | null {
  if (text.length > MAX_MESSAGE_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m['t']) {
    case 'hello':
      return onlyKeys(m, ['t', 'v']) && isInt(m['v'], 0, 1_000_000) ? { t: 'hello', v: m['v'] } : null;
    case 'create':
      return onlyKeys(m, ['t']) ? { t: 'create' } : null;
    case 'join': {
      if (!onlyKeys(m, ['t', 'code'])) return null;
      const code = m['code'];
      return isRoomCode(code) ? { t: 'join', code } : null;
    }
    case 'in':
      return onlyKeys(m, ['t', 's', 'k']) && isInt(m['s'], 0, MAX_SEQ) && isInt(m['k'], 0, KEY_MASK)
        ? { t: 'in', s: m['s'], k: m['k'] }
        : null;
    case 'rematch':
      return onlyKeys(m, ['t']) ? { t: 'rematch' } : null;
    case 'leave':
      return onlyKeys(m, ['t']) ? { t: 'leave' } : null;
    default:
      return null;
  }
}

const POS_LIMIT = ARENA_HALF + 1;
const POINT_LIMIT = ARENA_HALF + 5;
const VEL_LIMIT = SNOWBALL_SPEED * 2;
const MAX_AMMO_VALUE = 100_000;

function parsePose(v: unknown): Pose | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  return isNum(p['x'], POS_LIMIT) && isNum(p['z'], POS_LIMIT) && isNum(p['yaw'], 10)
    ? { x: p['x'], z: p['z'], yaw: p['yaw'] }
    : null;
}

function parseTuple(v: unknown, limit: number): Vec3Tuple | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => isNum(n, limit))
    ? [v[0] as number, v[1] as number, v[2] as number]
    : null;
}

function isWho(v: unknown): v is Who {
  return v === 'you' || v === 'opp';
}

function parseEvent(v: unknown): GameEvent | null {
  if (typeof v !== 'object' || v === null) return null;
  const e = v as Record<string, unknown>;
  if (e['k'] === 'throw' && isWho(e['by']) && isInt(e['id'], 0, MAX_SEQ)) {
    const from = parseTuple(e['from'], POINT_LIMIT);
    const vel = parseTuple(e['vel'], VEL_LIMIT);
    return from && vel ? { k: 'throw', by: e['by'], id: e['id'], from, vel } : null;
  }
  if (e['k'] === 'splat' && isInt(e['id'], 0, MAX_SEQ)) {
    const at = parseTuple(e['at'], POINT_LIMIT);
    return at ? { k: 'splat', id: e['id'], at } : null;
  }
  if (e['k'] === 'hit' && isWho(e['by'])) return { k: 'hit', by: e['by'] };
  if (e['k'] === 'spawn' && isWho(e['who']) && isNum(e['x'], POS_LIMIT) && isNum(e['z'], POS_LIMIT)) {
    return { k: 'spawn', who: e['who'], x: e['x'], z: e['z'] };
  }
  return null;
}

const REJECT_REASONS: readonly RejectReason[] = ['version', 'busy', 'full', 'bad_code', 'timeout', 'protocol'];
const END_REASONS: readonly EndReason[] = ['opponent_left', 'time_limit', 'idle', 'room_expired', 'server_shutdown'];

/** Parses one frame from the server; the client ignores anything invalid. */
export function parseServerMessage(text: string): ServerMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  switch (m['t']) {
    case 'welcome':
      return isInt(m['v'], 0, 1_000_000) && isInt(m['hz'], 1, 240) ? { t: 'welcome', v: m['v'], hz: m['hz'] } : null;
    case 'reject':
      return REJECT_REASONS.includes(m['reason'] as RejectReason)
        ? { t: 'reject', reason: m['reason'] as RejectReason }
        : null;
    case 'room':
      return isRoomCode(m['code']) && (m['seat'] === 0 || m['seat'] === 1)
        ? { t: 'room', code: m['code'], seat: m['seat'] }
        : null;
    case 'start': {
      const you = parsePose(m['you']);
      const opp = parsePose(m['opp']);
      return isInt(m['tick'], 0, Number.MAX_SAFE_INTEGER) && you && opp && isNum(m['go'], 10) && (m['go'] as number) >= 0
        ? { t: 'start', tick: m['tick'], you, opp, go: m['go'] as number }
        : null;
    }
    case 'over': {
      const score = m['score'];
      if (!Array.isArray(score) || score.length !== 2 || !score.every((n) => isInt(n, 0, 1_000_000))) return null;
      return isWho(m['winner'])
        ? { t: 'over', score: [score[0] as number, score[1] as number], winner: m['winner'] }
        : null;
    }
    case 'rematch': {
      return { t: 'rematch' };
    }
    case 'snap': {
      const you = parsePose(m['you']);
      const opp = parsePose(m['opp']);
      const score = m['score'];
      const ev = m['ev'];
      if (!isInt(m['tick'], 0, Number.MAX_SAFE_INTEGER) || !isInt(m['ack'], -1, MAX_SEQ) || !you || !opp) return null;
      if (!isInt(m['ammo'], 0, MAX_AMMO_VALUE) || !isNum(m['next'], AMMO_INTERVAL) || (m['next'] as number) < 0) return null;
      if (!Array.isArray(score) || score.length !== 2 || !score.every((n) => isInt(n, 0, 1_000_000))) return null;
      if (!Array.isArray(ev) || ev.length > 32) return null;
      const events: GameEvent[] = [];
      for (const e of ev) {
        const parsed = parseEvent(e);
        if (!parsed) return null;
        events.push(parsed);
      }
      return {
        t: 'snap',
        tick: m['tick'],
        ack: m['ack'],
        you,
        opp,
        score: [score[0] as number, score[1] as number],
        ammo: m['ammo'],
        next: m['next'] as number,
        ev: events,
      };
    }
    case 'end':
      return END_REASONS.includes(m['reason'] as EndReason) ? { t: 'end', reason: m['reason'] as EndReason } : null;
    default:
      return null;
  }
}

/** Server status for the menu (GET /status). */
export interface StatusResponse {
  state: 'free' | 'busy';
  protocol: number;
}

export function parseStatus(raw: unknown): StatusResponse | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  return (s['state'] === 'free' || s['state'] === 'busy') && isInt(s['protocol'], 0, 1_000_000)
    ? { state: s['state'], protocol: s['protocol'] }
    : null;
}
