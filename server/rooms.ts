// Rooms: codes, the room limit (MAX_ROOMS), timeouts and the 30 Hz tick of every match (docs/NETWORKING.md §4).
import { MAPS, type MapId } from '../shared/maps.ts';
import { createRoomCode, type RandomInt } from '../shared/room-code.ts';
import { TICK_DT, type EndReason, type ServerMessage } from '../shared/protocol.ts';
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
  /** How long a finished match waits for both players to ask for a rematch. */
  rematchTimeoutMs: number;
  /** Countdown before a match starts (s); tests use 0. */
  countdownSeconds?: number;
}

interface Room {
  code: string;
  seats: [Player, Player | null];
  createdAt: number;
  match: Match | null;
  startedAt: number;
  /** Set when the match is over (someone reached WIN_SCORE); the room then waits for a rematch. */
  overAt: number | null;
  rematch: [boolean, boolean];
  /** The arena the host chose. */
  map: MapId;
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

  create(player: Player, now: number, map: MapId = 'classic'): CreateResult {
    if (this.busy) return { ok: false, reason: 'busy' };
    let code: string;
    do code = createRoomCode(this.randomInt);
    while (this.rooms.has(code));
    const room: Room = { code, seats: [player, null], createdAt: now, match: null, startedAt: 0, overAt: null, rematch: [false, false], map };
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
    player.send({ t: 'room', code, seat: 1 });
    this.startMatch(room, now);
    return { ok: true };
  }

  private startMatch(room: Room, now: number): void {
    const match = new Match(this.rng, this.timeouts.countdownSeconds, MAPS[room.map]);
    room.match = match;
    room.startedAt = now;
    room.overAt = null;
    room.rematch = [false, false];
    for (const seat of [0, 1] as const) {
      room.seats[seat]!.send({
        t: 'start', tick: 0, you: match.pose(seat), opp: match.pose(seat === 0 ? 1 : 0), go: match.goTick * TICK_DT, map: room.map,
      });
    }
    this.onEvent('match_started');
  }

  /** A player asks for a rematch after a finished match. Returns false when the match is not over (ignored). */
  requestRematch(player: Player, now: number): boolean {
    const found = this.roomOf(player);
    if (!found || found.room.overAt === null || found.room.rematch[found.seat]) return false;
    const { room, seat } = found;
    room.rematch[seat] = true;
    if (room.rematch[0] && room.rematch[1]) this.startMatch(room, now);
    else room.seats[seat === 0 ? 1 : 0]?.send({ t: 'rematch' });
    return true;
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
      if (room.overAt !== null) {
        if (now - room.overAt >= this.timeouts.rematchTimeoutMs) this.closeAll(room, 'room_expired');
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
      const match = room.match;
      match.step();
      for (const seat of [0, 1] as const) room.seats[seat]!.send(match.snapshot(seat));
      if (match.winner !== null) {
        room.overAt = now;
        for (const seat of [0, 1] as const) {
          const other = seat === 0 ? 1 : 0;
          room.seats[seat]!.send({
            t: 'over', score: [match.score[seat], match.score[other]], winner: match.winner === seat ? 'you' : 'opp',
          });
        }
        this.onEvent('match_over', { ticks: match.tick });
      }
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
