import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServerMessage } from '../shared/protocol.ts';
import { seededRng } from '../shared/rng.ts';
import { RoomManager, type Player } from './rooms.ts';

class FakePlayer implements Player {
  inbox: ServerMessage[] = [];
  ended = false;
  send(msg: ServerMessage): void {
    this.inbox.push(msg);
  }
  end(): void {
    this.ended = true;
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.inbox.filter((m) => m.t === t).pop() as Extract<ServerMessage, { t: T }> | undefined;
  }
}

const timeouts = { waitingRoomTimeoutMs: 1000, idleTimeoutMs: 2000, matchMaxMs: 10_000, rematchTimeoutMs: 5000, countdownSeconds: 0 };
const manager = (max = 1) => {
  const rng = seededRng(1);
  return new RoomManager(max, timeouts, rng, (n) => Math.floor(rng() * n));
};

test('one room by default: a second create is refused as busy', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  assert.equal(rooms.busy, true);
  assert.deepEqual(rooms.create(new FakePlayer(), 0), { ok: false, reason: 'busy' });
});

test('MAX_ROOMS > 1 allows more rooms', () => {
  const rooms = manager(2);
  assert.ok(rooms.create(new FakePlayer(), 0).ok);
  assert.equal(rooms.busy, false);
  assert.ok(rooms.create(new FakePlayer(), 0).ok);
  assert.equal(rooms.busy, true);
});

test('joining starts the match for both; a third player gets "full"; a wrong code "bad_code"', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  assert.deepEqual(rooms.join(new FakePlayer(), 'ZZZZZ', 0), { ok: false, reason: 'bad_code' });
  assert.deepEqual(rooms.join(b, r.code, 0), { ok: true });
  assert.ok(a.last('start') && b.last('start'));
  assert.deepEqual(rooms.join(new FakePlayer(), r.code, 0), { ok: false, reason: 'full' });
});

test('every tick sends each player a snapshot', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(b, r.code, 0);
  rooms.tick(10);
  rooms.tick(43);
  assert.equal(a.inbox.filter((m) => m.t === 'snap').length, 2);
  assert.equal(b.last('snap')?.tick, 2);
});

test('a waiting room expires and frees the slot', () => {
  const rooms = manager();
  const a = new FakePlayer();
  rooms.create(a, 0);
  rooms.tick(999);
  assert.equal(rooms.busy, true);
  rooms.tick(1000);
  assert.equal(rooms.busy, false);
  assert.deepEqual(a.last('end'), { t: 'end', reason: 'room_expired' });
  assert.equal(a.ended, true);
});

test('leaving ends the match for the opponent and frees the slot', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(b, r.code, 0);
  rooms.leave(b);
  assert.deepEqual(a.last('end'), { t: 'end', reason: 'opponent_left' });
  assert.equal(rooms.busy, false);
  rooms.leave(b); // leaving twice is harmless
});

test('an idle player is disconnected', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(b, r.code, 0);
  let s = 0;
  for (let t = 0; t <= 2100; t += 33) {
    rooms.input(b, s++, 1); // b keeps walking, a does nothing
    rooms.tick(t);
    if (!rooms.busy) break;
  }
  assert.deepEqual(a.last('end'), { t: 'end', reason: 'idle' });
  assert.deepEqual(b.last('end'), { t: 'end', reason: 'opponent_left' });
});

test('a match ends at the time limit', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(b, r.code, 0);
  rooms.tick(10_000);
  assert.deepEqual(a.last('end'), { t: 'end', reason: 'time_limit' });
  assert.deepEqual(b.last('end'), { t: 'end', reason: 'time_limit' });
});

function finishedRoom(): { rooms: RoomManager; a: FakePlayer; b: FakePlayer } {
  const rooms = manager();
  const a = new FakePlayer();
  const b = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(b, r.code, 0);
  // Let seat 0 win: put the score one short and land a snowball.
  const found = rooms.roomOf(a)!;
  const match = found.room.match!;
  match.score[0] = 9;
  match.players[0].state.pos = { x: 5, z: 6 };
  match.players[0].state.yaw = 0;
  match.players[1].state.pos = { x: 5, z: -2 };
  rooms.input(a, 0, 64);
  for (let t = 0; t < 60 && found.room.overAt === null; t++) rooms.tick(100 + t);
  return { rooms, a, b };
}

test('reaching WIN_SCORE ends the match for both, with the score and the winner, and keeps the room', () => {
  const { rooms, a, b } = finishedRoom();
  assert.deepEqual(a.last('over'), { t: 'over', score: [10, 0], winner: 'you' });
  assert.deepEqual(b.last('over'), { t: 'over', score: [0, 10], winner: 'opp' });
  assert.equal(a.ended, false);
  assert.equal(rooms.busy, true);
  const snaps = a.inbox.filter((m) => m.t === 'snap').length;
  rooms.tick(1000);
  assert.equal(a.inbox.filter((m) => m.t === 'snap').length, snaps, 'no more snapshots after the end');
});

test('a rematch starts when both ask; the first request is shown to the opponent', () => {
  const { rooms, a, b } = finishedRoom();
  const starts = a.inbox.filter((m) => m.t === 'start').length;
  assert.equal(rooms.requestRematch(a, 2000), true);
  assert.deepEqual(b.last('rematch'), { t: 'rematch' });
  assert.equal(rooms.requestRematch(a, 2001), false, 'asking twice changes nothing');
  assert.equal(rooms.requestRematch(b, 2002), true);
  assert.equal(a.inbox.filter((m) => m.t === 'start').length, starts + 1);
  assert.deepEqual(rooms.roomOf(a)!.room.match!.score, [0, 0]);
});

test('without a rematch the finished room closes after the timeout', () => {
  const { rooms, a, b } = finishedRoom();
  rooms.requestRematch(a, 2000);
  rooms.tick(100_000);
  assert.deepEqual(a.last('end'), { t: 'end', reason: 'room_expired' });
  assert.deepEqual(b.last('end'), { t: 'end', reason: 'room_expired' });
  assert.equal(rooms.busy, false);
});

test('a rematch request during a running match is ignored', () => {
  const rooms = manager();
  const a = new FakePlayer();
  const r = rooms.create(a, 0);
  assert.ok(r.ok);
  rooms.join(new FakePlayer(), r.code, 0);
  assert.equal(rooms.requestRematch(a, 1), false);
});
