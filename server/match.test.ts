import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPosition } from '../shared/arena.ts';
import { MOVE_SPEED, START_AMMO, THROW_COOLDOWN } from '../shared/constants.ts';
import { KEY_FIRE, KEY_FORWARD, TICK_DT } from '../shared/protocol.ts';
import { seededRng } from '../shared/rng.ts';
import { Match, MAX_QUEUED_INPUTS } from './match.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function facingDuel(): Match {
  const m = new Match(seededRng(1), 0);
  m.players[0].state.pos = { x: 5, z: 6 };
  m.players[0].state.yaw = 0; // faces -z, towards the guest
  m.players[1].state.pos = { x: 5, z: -6 };
  return m;
}

test('the server moves a player only by its inputs, at MOVE_SPEED', () => {
  const m = new Match(seededRng(1), 0);
  for (let s = 0; s < 3; s++) m.pushInput(0, s, KEY_FORWARD);
  for (let i = 0; i < 3; i++) m.step();
  near(m.players[0].state.pos.z, 6 - 3 * MOVE_SPEED * TICK_DT);
  assert.equal(m.players[0].ack, 2);
  near(m.players[1].state.pos.z, -6); // no input, no movement
});

test('input sequence numbers must grow', () => {
  const m = new Match(seededRng(1), 0);
  assert.equal(m.pushInput(0, 5, 0), true);
  assert.equal(m.pushInput(0, 5, 0), false);
  assert.equal(m.pushInput(0, 4, 0), false);
});

test('at most MAX_QUEUED_INPUTS are kept; a backlog drains two per tick', () => {
  const m = new Match(seededRng(1), 0);
  for (let s = 0; s < 10; s++) m.pushInput(0, s, KEY_FORWARD);
  assert.equal(m.players[0].queue.length, MAX_QUEUED_INPUTS);
  m.step();
  assert.equal(m.players[0].queue.length, MAX_QUEUED_INPUTS - 2);
  assert.equal(m.players[0].ack, 7);
});

function throwOnce(m: Match, seat: 0 | 1, seq: number): number {
  m.pushInput(seat, seq, KEY_FIRE);
  m.step();
  m.pushInput(seat, seq + 1, 0);
  m.step();
  return seq + 2;
}

function flyFor(m: Match, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / TICK_DT); i++) m.step();
}

test('a snowball thrown straight at the opponent scores, respawns the victim and tells both players', () => {
  const m = facingDuel();
  throwOnce(m, 0, 0);
  const hostThrow = m.snapshot(0).ev.find((e) => e.k === 'throw');
  assert.equal(hostThrow?.k === 'throw' && hostThrow.by, 'you');
  assert.equal(m.players[0].thrower.ammo, START_AMMO - 1);
  flyFor(m, 1.5);
  assert.deepEqual(m.score, [1, 0]);
  assert.ok(isValidPosition(m.players[1].state.pos));
  const host = m.snapshot(0);
  const guest = m.snapshot(1);
  assert.deepEqual(host.score, [1, 0]);
  assert.deepEqual(guest.score, [0, 1]);
  assert.deepEqual(host.ev.map((e) => e.k), ['splat', 'hit', 'spawn']);
  assert.deepEqual(guest.ev.find((e) => e.k === 'hit'), { k: 'hit', by: 'opp' });
  assert.deepEqual(guest.ev.find((e) => e.k === 'spawn'), {
    k: 'spawn', who: 'you', x: m.players[1].state.pos.x, z: m.players[1].state.pos.z,
  });
  assert.equal(m.snowballs.length, 0);
});

test('the snowball needs time to fly: no hit on the first tick', () => {
  const m = facingDuel();
  m.pushInput(0, 0, KEY_FIRE);
  m.step();
  assert.deepEqual(m.score, [0, 0]);
  assert.equal(m.snowballs.length, 1);
});

test('a target that steps aside is missed', () => {
  const m = facingDuel();
  throwOnce(m, 0, 0);
  m.players[1].state.pos = { x: 7, z: -6 };
  flyFor(m, 2);
  assert.deepEqual(m.score, [0, 0]);
  assert.equal(m.snowballs.length, 0, 'it splatted somewhere');
});

test('the crate stops snowballs', () => {
  const m = new Match(seededRng(1), 0); // spawns face each other across the crate
  throwOnce(m, 0, 0);
  flyFor(m, 2);
  assert.deepEqual(m.score, [0, 0]);
});

test('holding fire throws once; each press costs a snowball; an empty stock throws nothing', () => {
  const m = new Match(seededRng(1), 0);
  for (let s = 0; s < 30; s++) {
    m.pushInput(0, s, KEY_FIRE);
    m.step();
  }
  assert.equal(m.players[0].thrower.ammo, START_AMMO - 1);
  let seq = 30;
  for (let i = 0; i < 10; i++) {
    seq = throwOnce(m, 0, seq);
    flyFor(m, THROW_COOLDOWN);
  }
  assert.equal(m.players[0].thrower.ammo, 0);
  const throwsBefore = m.snowballs.length;
  throwOnce(m, 0, seq);
  assert.equal(m.snowballs.length, throwsBefore);
});

test('a new snowball arrives every 10 s and the snapshot says so', () => {
  const m = new Match(seededRng(1), 0);
  flyFor(m, 9.9);
  assert.equal(m.snapshot(0).ammo, START_AMMO);
  assert.ok(Math.abs(m.snapshot(0).next - 0.1) < 0.05);
  flyFor(m, 0.2);
  const snap = m.snapshot(0);
  assert.equal(snap.ammo, START_AMMO + 1);
  assert.ok(Math.abs(snap.next - 9.9) < 0.05, `next ${snap.next}`);
});

test('idle time counts ticks since the last pressed key', () => {
  const m = new Match(seededRng(1), 0);
  for (let i = 0; i < 30; i++) m.step();
  near(m.idleSeconds(0), 1);
  m.pushInput(0, 0, KEY_FORWARD);
  m.step();
  near(m.idleSeconds(0), 0);
});

test('during the countdown inputs are acknowledged but nobody moves or throws', () => {
  const m = new Match(seededRng(1), 1); // 1 s = 30 ticks
  for (let s = 0; s < 10; s++) {
    m.pushInput(0, s, KEY_FORWARD | (s === 0 ? KEY_FIRE : 0));
    m.step();
  }
  near(m.players[0].state.pos.z, 6);
  assert.equal(m.players[0].ack, 9);
  assert.equal(m.snowballs.length, 0);
  assert.equal(m.players[0].thrower.ammo, START_AMMO);
});

test('a respawned player is protected: snowballs fly through for 1.5 s', () => {
  const m = facingDuel();
  m.players[1].protectedUntil = m.tick + 45;
  throwOnce(m, 0, 0);
  for (let i = 0; i < 20; i++) {
    m.players[1].state.pos = { x: 5, z: -6 };
    m.step();
  }
  assert.deepEqual(m.score, [0, 0]);
});

test('a hit sets the victim\'s protection and the tenth point decides the match', () => {
  const m = facingDuel();
  m.score[0] = 9;
  throwOnce(m, 0, 0);
  flyFor(m, 1.5);
  assert.deepEqual(m.score, [10, 0]);
  assert.equal(m.winner, 0);
  assert.ok(m.players[1].protectedUntil > m.tick - 45);
  const tick = m.tick;
  m.step();
  assert.equal(m.tick, tick, 'a finished match does not step');
});
