import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPosition } from '../shared/arena.ts';
import { MOVE_SPEED } from '../shared/constants.ts';
import { KEY_FIRE, KEY_FORWARD, TICK_DT } from '../shared/protocol.ts';
import { seededRng } from '../shared/rng.ts';
import { Match, MAX_QUEUED_INPUTS } from './match.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function facingDuel(): Match {
  const m = new Match(seededRng(1));
  m.players[0].state.pos = { x: 5, z: 6 };
  m.players[0].state.yaw = 0; // faces -z, towards the guest
  m.players[1].state.pos = { x: 5, z: -6 };
  return m;
}

test('the server moves a player only by its inputs, at MOVE_SPEED', () => {
  const m = new Match(seededRng(1));
  for (let s = 0; s < 3; s++) m.pushInput(0, s, KEY_FORWARD);
  for (let i = 0; i < 3; i++) m.step();
  near(m.players[0].state.pos.z, 6 - 3 * MOVE_SPEED * TICK_DT);
  assert.equal(m.players[0].ack, 2);
  near(m.players[1].state.pos.z, -6); // no input, no movement
});

test('input sequence numbers must grow', () => {
  const m = new Match(seededRng(1));
  assert.equal(m.pushInput(0, 5, 0), true);
  assert.equal(m.pushInput(0, 5, 0), false);
  assert.equal(m.pushInput(0, 4, 0), false);
});

test('at most MAX_QUEUED_INPUTS are kept; a backlog drains two per tick', () => {
  const m = new Match(seededRng(1));
  for (let s = 0; s < 10; s++) m.pushInput(0, s, KEY_FORWARD);
  assert.equal(m.players[0].queue.length, MAX_QUEUED_INPUTS);
  m.step();
  assert.equal(m.players[0].queue.length, MAX_QUEUED_INPUTS - 2);
  assert.equal(m.players[0].ack, 7);
});

test('a shot straight at the opponent scores, respawns the victim and reports events to both', () => {
  const m = facingDuel();
  m.pushInput(0, 0, KEY_FIRE);
  m.step();
  assert.deepEqual(m.score, [1, 0]);
  assert.ok(isValidPosition(m.players[1].state.pos));
  const host = m.snapshot(0);
  const guest = m.snapshot(1);
  assert.deepEqual(host.score, [1, 0]);
  assert.deepEqual(guest.score, [0, 1]);
  assert.deepEqual(host.ev.map((e) => e.k), ['shot', 'hit', 'spawn']);
  assert.deepEqual(guest.ev.find((e) => e.k === 'hit'), { k: 'hit', by: 'opp' });
  assert.deepEqual(guest.ev.find((e) => e.k === 'spawn')?.k === 'spawn' && guest.ev.find((e) => e.k === 'spawn'), {
    k: 'spawn', who: 'you', x: m.players[1].state.pos.x, z: m.players[1].state.pos.z,
  });
  assert.equal(m.snapshot(0).ev.length, 0, 'events are sent once');
});

test('the crate blocks shots', () => {
  const m = new Match(seededRng(1)); // spawns face each other across the crate
  m.pushInput(0, 0, KEY_FIRE);
  m.step();
  assert.deepEqual(m.score, [0, 0]);
});

test('holding fire shoots every 4 ticks (0.12 s rounded up to ticks)', () => {
  const m = new Match(seededRng(1));
  let shots = 0;
  for (let s = 0; s < 30; s++) {
    m.pushInput(0, s, KEY_FIRE);
    m.step();
    shots += m.snapshot(0).ev.filter((e) => e.k === 'shot').length;
  }
  assert.equal(shots, 8);
});

test('after a hit the same shooter cannot score again for 0.6 s', () => {
  const m = facingDuel();
  let s = 0;
  for (let i = 0; i < 12; i++) {
    m.players[1].state.pos = { x: 5, z: -6 }; // keep the target in the line of fire
    m.pushInput(0, s++, KEY_FIRE);
    m.step();
  }
  // Shots at ticks 1, 5, 9: only the first scores (0.6 s = 18 ticks).
  assert.deepEqual(m.score, [1, 0]);
});

test('idle time counts ticks since the last pressed key', () => {
  const m = new Match(seededRng(1));
  for (let i = 0; i < 30; i++) m.step();
  near(m.idleSeconds(0), 1);
  m.pushInput(0, 0, KEY_FORWARD);
  m.step();
  near(m.idleSeconds(0), 0);
});
