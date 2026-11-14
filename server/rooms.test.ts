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

const timeouts = { waitingRoomTimeoutMs: 1000, idleTimeoutMs: 2000, matchMaxMs: 10_000 };
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
