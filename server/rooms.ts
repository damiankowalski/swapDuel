// Rooms: codes, the room limit (MAX_ROOMS), timeouts and the 30 Hz tick of every match (docs/NETWORKING.md §4).
import { createRoomCode, type RandomInt } from '../shared/room-code.ts';
import type { EndReason, ServerMessage } from '../shared/protocol.ts';
import type { Rng } from '../shared/rng.ts';
import { Match, type Seat } from './match.ts';

/** What a room needs from a connection; the WebSocket layer implements it. */
export interface Player {
  send(msg: ServerMessage): void;
  /** Ends the connection after the queued messages. */
  end(): void;
}

export interface RoomTimeouts {
  waitingRoomTimeoutMs: number;
  idleTimeoutMs: number;
  matchMaxMs: number;
}

interface Room {
  code: string;
  seats: [Player, Player | null];
  createdAt: number;
  match: Match | null;
  startedAt: number;
}

export type CreateResult = { ok: true; code: string } | { ok: false; reason: 'busy' };
export type JoinResult = { ok: true } | { ok: false; reason: 'bad_code' | 'full' };

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly byPlayer = new Map<Player, Room>();
  private readonly maxRooms: number;
  private readonly timeouts: RoomTimeouts;
  private readonly rng: Rng;
  private readonly randomInt: RandomInt;
  onEvent: (event: string, fields?: Record<string, unknown>) => void = () => {};

  constructor(maxRooms: number, timeouts: RoomTimeouts, rng: Rng, randomInt: RandomInt) {
    this.maxRooms = maxRooms;
    this.timeouts = timeouts;
    this.rng = rng;
    this.randomInt = randomInt;
  }

  get busy(): boolean {
    return this.rooms.size >= this.maxRooms;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  roomOf(player: Player): { room: Room; seat: Seat } | null {
    const room = this.byPlayer.get(player);
    if (!room) return null;
    return { room, seat: room.seats[0] === player ? 0 : 1 };
  }

  create(player: Player, now: number): CreateResult {
    if (this.busy) return { ok: false, reason: 'busy' };
    let code: string;
    do code = createRoomCode(this.randomInt);
    while (this.rooms.has(code));
    const room: Room = { code, seats: [player, null], createdAt: now, match: null, startedAt: 0 };
    this.rooms.set(code, room);
    this.byPlayer.set(player, room);
    player.send({ t: 'room', code, seat: 0 });
    this.onEvent('room_created', { rooms: this.rooms.size });
    return { ok: true, code };
  }

  join(player: Player, code: string, now: number): JoinResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'bad_code' };
    if (room.seats[1] || room.seats[0] === player) return { ok: false, reason: 'full' };
    room.seats[1] = player;
    this.byPlayer.set(player, room);
    room.match = new Match(this.rng);
    room.startedAt = now;
    player.send({ t: 'room', code, seat: 1 });
    for (const seat of [0, 1] as const) {
      room.seats[seat]!.send({ t: 'start', tick: 0, you: room.match.pose(seat), opp: room.match.pose(seat === 0 ? 1 : 0) });
    }
    this.onEvent('match_started');
    return { ok: true };
  }

  /** Queues an input; false = protocol violation (sequence did not grow) or not in a match. */
  input(player: Player, s: number, k: number): boolean {
    const found = this.roomOf(player);
    if (!found || !found.room.match) return false;
    return found.room.match.pushInput(found.seat, s, k);
  }

  /** A player left or disconnected. */
  leave(player: Player): void {
    const found = this.roomOf(player);
    if (!found) return;
    const opponent = found.room.seats[found.seat === 0 ? 1 : 0];
    this.close(found.room, opponent ? new Map([[opponent, 'opponent_left' as EndReason]]) : new Map(), 'left');
  }

  /** One 30 Hz tick: timeouts, then every running match steps and sends snapshots. */
  tick(now: number): void {
    for (const room of [...this.rooms.values()]) {
      if (!room.match) {
        if (now - room.createdAt >= this.timeouts.waitingRoomTimeoutMs) {
          this.close(room, new Map([[room.seats[0], 'room_expired' as EndReason]]), 'room_expired');
        }
        continue;
      }
      if (now - room.startedAt >= this.timeouts.matchMaxMs) {
        this.closeAll(room, 'time_limit');
        continue;
      }
      const idleSeat = ([0, 1] as const).find((s) => room.match!.idleSeconds(s) * 1000 >= this.timeouts.idleTimeoutMs);
      if (idleSeat !== undefined) {
        const idle = room.seats[idleSeat]!;
        const other = room.seats[idleSeat === 0 ? 1 : 0]!;
        this.close(room, new Map<Player, EndReason>([[idle, 'idle'], [other, 'opponent_left']]), 'idle');
        continue;
      }
      room.match.step();
      for (const seat of [0, 1] as const) room.seats[seat]!.send(room.match.snapshot(seat));
    }
  }

  /** Ends every room (server shutdown). */
  shutdown(): void {
    for (const room of [...this.rooms.values()]) this.closeAll(room, 'server_shutdown');
  }

  private closeAll(room: Room, reason: EndReason): void {
    const notify = new Map<Player, EndReason>();
    for (const p of room.seats) if (p) notify.set(p, reason);
    this.close(room, notify, reason);
  }

  private close(room: Room, notify: Map<Player, EndReason>, why: string): void {
    this.rooms.delete(room.code);
    for (const p of room.seats) if (p) this.byPlayer.delete(p);
    for (const [p, reason] of notify) {
      p.send({ t: 'end', reason });
      p.end();
    }
    this.onEvent('room_closed', { why, ticks: room.match?.tick ?? 0, rooms: this.rooms.size });
  }
}
