// Authoritative simulation of one duel (docs/NETWORKING.md §5-6). No I/O: the room feeds inputs and sends snapshots.
import { randomSpawnPoint } from '../shared/arena.ts';
import { FIRE_INTERVAL, HIT_COOLDOWN, SPAWN_GUEST, SPAWN_HOST } from '../shared/constants.ts';
import { aimDirection } from '../shared/math.ts';
import { applyInput } from '../shared/netsim.ts';
import type { PlayerState } from '../shared/player.ts';
import { KEY_FIRE, TICK_DT, type GameEvent, type Pose, type ServerMessage, type Who } from '../shared/protocol.ts';
import type { Rng } from '../shared/rng.ts';
import { castShot, eyeOf, muzzleOf } from '../shared/shot.ts';

/** Inputs queued per player; beyond this the oldest is dropped (no "banking" of moves). */
export const MAX_QUEUED_INPUTS = 4;
const MAX_EVENTS = 32;

export type Seat = 0 | 1;

interface MatchPlayer {
  state: PlayerState;
  queue: Array<{ s: number; k: number }>;
  lastQueuedSeq: number;
  ack: number;
  fireCd: number;
  hitCd: number;
  events: GameEvent[];
  /** Tick of the last processed input with any key pressed. */
  lastActiveTick: number;
}

function newPlayer(spawn: Pose): MatchPlayer {
  return {
    state: { pos: { x: spawn.x, z: spawn.z }, yaw: spawn.yaw, pitch: 0 },
    queue: [],
    lastQueuedSeq: -1,
    ack: -1,
    fireCd: 0,
    hitCd: 0,
    events: [],
    lastActiveTick: 0,
  };
}

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const rel = (seat: Seat, actor: Seat): Who => (seat === actor ? 'you' : 'opp');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class Match {
  tick = 0;
  readonly score: [number, number] = [0, 0];
  readonly players: [MatchPlayer, MatchPlayer];
  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
    this.players = [newPlayer(SPAWN_HOST), newPlayer(SPAWN_GUEST)];
  }

  /** Queues an input. Returns false when `s` does not grow (a protocol violation). */
  pushInput(seat: Seat, s: number, k: number): boolean {
    const p = this.players[seat];
    if (s <= p.lastQueuedSeq) return false;
    p.lastQueuedSeq = s;
    p.queue.push({ s, k });
    if (p.queue.length > MAX_QUEUED_INPUTS) p.queue.shift();
    return true;
  }

  /** One server tick: up to one input per player (two when it has a backlog), shots, hits, respawns. */
  step(): void {
    this.tick++;
    const order: Seat[] = this.tick % 2 === 0 ? [0, 1] : [1, 0];
    for (const seat of order) {
      const p = this.players[seat];
      p.hitCd -= TICK_DT;
      const budget = p.queue.length > 2 ? 2 : 1;
      for (let i = 0; i < budget && p.queue.length > 0; i++) this.apply(seat, p.queue.shift()!);
    }
  }

  private apply(seat: Seat, input: { s: number; k: number }): void {
    const p = this.players[seat];
    applyInput(p.state, input.k);
    p.ack = input.s;
    if (input.k !== 0) p.lastActiveTick = this.tick;

    if ((input.k & KEY_FIRE) === 0) {
      p.fireCd = 0;
      return;
    }
    p.fireCd -= TICK_DT;
    if (p.fireCd > 0) return;
    p.fireCd = FIRE_INTERVAL;

    const victimSeat = other(seat);
    const victim = this.players[victimSeat];
    const shot = castShot(eyeOf(p.state.pos), aimDirection(p.state.yaw, 0), victim.state.pos);
    const from = muzzleOf(p.state.pos, p.state.yaw);
    for (const s of [0, 1] as const) {
      this.emit(s, { k: 'shot', by: rel(s, seat), from: [r3(from.x), r3(from.y), r3(from.z)], to: [r3(shot.point.x), r3(shot.point.y), r3(shot.point.z)] });
    }
    if (shot.hit !== 'target' || p.hitCd > 0) return;

    p.hitCd = HIT_COOLDOWN;
    this.score[seat]++;
    victim.state.pos = randomSpawnPoint(this.rng);
    for (const s of [0, 1] as const) {
      this.emit(s, { k: 'hit', by: rel(s, seat) });
      this.emit(s, { k: 'spawn', who: rel(s, victimSeat), x: victim.state.pos.x, z: victim.state.pos.z });
    }
  }

  private emit(seat: Seat, e: GameEvent): void {
    const list = this.players[seat].events;
    if (list.length < MAX_EVENTS) list.push(e);
  }

  pose(seat: Seat): Pose {
    const s = this.players[seat].state;
    return { x: s.pos.x, z: s.pos.z, yaw: s.yaw };
  }

  /** The snapshot for one seat; drains that seat's events. */
  snapshot(seat: Seat): Extract<ServerMessage, { t: 'snap' }> {
    const p = this.players[seat];
    const ev = p.events;
    p.events = [];
    return {
      t: 'snap',
      tick: this.tick,
      ack: p.ack,
      you: this.pose(seat),
      opp: this.pose(other(seat)),
      score: [this.score[seat], this.score[other(seat)]],
      ev,
    };
  }

  /** Seconds since the player last pressed any key. */
  idleSeconds(seat: Seat): number {
    return (this.tick - this.players[seat].lastActiveTick) * TICK_DT;
  }
}
