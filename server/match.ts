// Authoritative simulation of one duel (docs/NETWORKING.md §5-6). No I/O: the room feeds inputs and sends snapshots.
import { randomSpawnPoint } from '../shared/arena.ts';
import { SPAWN_GUEST, SPAWN_HOST } from '../shared/constants.ts';
import { applyInput } from '../shared/netsim.ts';
import type { PlayerState } from '../shared/player.ts';
import { KEY_FIRE, TICK_DT, type GameEvent, type Pose, type ServerMessage, type Who } from '../shared/protocol.ts';
import type { Rng } from '../shared/rng.ts';
import {
  createThrower,
  launch,
  pressFire,
  secondsToNextSnowball,
  stepSnowball,
  tickThrower,
  type Snowball,
  type Thrower,
} from '../shared/snowball.ts';

/** Inputs queued per player; beyond this the oldest is dropped (no "banking" of moves). */
export const MAX_QUEUED_INPUTS = 4;
/** Snowballs in the air at once, both players together; more would mean a bug or abuse. */
export const MAX_SNOWBALLS = 64;
const MAX_EVENTS = 32;

export type Seat = 0 | 1;

interface MatchPlayer {
  state: PlayerState;
  queue: Array<{ s: number; k: number }>;
  lastQueuedSeq: number;
  ack: number;
  thrower: Thrower;
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
    thrower: createThrower(),
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
  readonly snowballs: Snowball[] = [];
  private nextBallId = 1;
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

  /** One server tick: refills, up to one input per player (two with a backlog), then the snowballs fly. */
  step(): void {
    this.tick++;
    const order: Seat[] = this.tick % 2 === 0 ? [0, 1] : [1, 0];
    for (const seat of order) {
      const p = this.players[seat];
      tickThrower(p.thrower, TICK_DT);
      const budget = p.queue.length > 2 ? 2 : 1;
      for (let i = 0; i < budget && p.queue.length > 0; i++) this.apply(seat, p.queue.shift()!);
    }
    this.fly();
  }

  private apply(seat: Seat, input: { s: number; k: number }): void {
    const p = this.players[seat];
    applyInput(p.state, input.k);
    p.ack = input.s;
    if (input.k !== 0) p.lastActiveTick = this.tick;
    if (!pressFire(p.thrower, (input.k & KEY_FIRE) !== 0)) return;
    if (this.snowballs.length >= MAX_SNOWBALLS) return;

    const start = launch(p.state.pos, p.state.yaw);
    const ball: Snowball = { id: this.nextBallId++, owner: seat, pos: start.pos, vel: start.vel, age: 0 };
    this.snowballs.push(ball);
    for (const s of [0, 1] as const) {
      this.emit(s, {
        k: 'throw',
        by: rel(s, seat),
        id: ball.id,
        from: [r3(start.pos.x), r3(start.pos.y), r3(start.pos.z)],
        vel: [r3(start.vel.x), r3(start.vel.y), r3(start.vel.z)],
      });
    }
  }

  /** Moves every snowball one tick; a snowball can only hit the other player. */
  private fly(): void {
    for (let i = this.snowballs.length - 1; i >= 0; i--) {
      const ball = this.snowballs[i]!;
      const victimSeat = other(ball.owner);
      const impact = stepSnowball(ball, TICK_DT, [{ seat: victimSeat, pos: this.players[victimSeat].state.pos }]);
      if (!impact) continue;
      this.snowballs.splice(i, 1);
      const at: [number, number, number] = [r3(impact.point.x), r3(impact.point.y), r3(impact.point.z)];
      for (const s of [0, 1] as const) this.emit(s, { k: 'splat', id: ball.id, at });
      if (impact.kind !== 'target') continue;

      this.score[ball.owner]++;
      const victim = this.players[victimSeat];
      victim.state.pos = randomSpawnPoint(this.rng);
      for (const s of [0, 1] as const) {
        this.emit(s, { k: 'hit', by: rel(s, ball.owner) });
        this.emit(s, { k: 'spawn', who: rel(s, victimSeat), x: victim.state.pos.x, z: victim.state.pos.z });
      }
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
      ammo: Math.min(p.thrower.ammo, 100_000),
      next: Math.round(secondsToNextSnowball(p.thrower) * 10) / 10,
      ev,
    };
  }

  /** Seconds since the player last pressed any key. */
  idleSeconds(seat: Seat): number {
    return (this.tick - this.players[seat].lastActiveTick) * TICK_DT;
  }
}
