import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPosition, randomSpawnPoint, resolveCollisions } from './arena.ts';
import { ARENA_HALF, CRATE_HALF, PLAYER_RADIUS } from './constants.ts';
import { seededRng } from './rng.ts';

const LIMIT = ARENA_HALF - PLAYER_RADIUS;
const REACH = CRATE_HALF + PLAYER_RADIUS;

test('a fighter is clamped inside the walls', () => {
  const pos = { x: 50, z: -50 };
  resolveCollisions(pos);
  assert.deepEqual(pos, { x: LIMIT, z: -LIMIT });
});

test('a fighter overlapping the crate is pushed out along the shorter overlap', () => {
  const pos = { x: 1.9, z: 0.5 }; // overlaps 0.2 on x, 1.6 on z
  resolveCollisions(pos);
  assert.deepEqual(pos, { x: REACH, z: 0.5 });

  const pos2 = { x: -0.3, z: -2.0 }; // overlaps 1.8 on x, 0.1 on z
  resolveCollisions(pos2);
  assert.deepEqual(pos2, { x: -0.3, z: -REACH });
});

test('a fighter exactly at the crate centre is pushed out to +z', () => {
  const pos = { x: 0, z: 0 };
  resolveCollisions(pos);
  assert.deepEqual(pos, { x: 0, z: REACH });
});

test('a free position is left alone', () => {
  const pos = { x: 4, z: -7 };
  resolveCollisions(pos);
  assert.deepEqual(pos, { x: 4, z: -7 });
  assert.equal(isValidPosition(pos), true);
});

test('isValidPosition rejects walls, crate and non-finite values', () => {
  assert.equal(isValidPosition({ x: LIMIT + 0.01, z: 0 }), false);
  assert.equal(isValidPosition({ x: 0.5, z: 0.5 }), false);
  assert.equal(isValidPosition({ x: Number.NaN, z: 0 }), false);
});

test('spawn points keep 1 m from the walls and the crate', () => {
  const rng = seededRng(42);
  for (let i = 0; i < 10_000; i++) {
    const p = randomSpawnPoint(rng);
    assert.ok(Math.abs(p.x) <= ARENA_HALF - 1 && Math.abs(p.z) <= ARENA_HALF - 1);
    assert.ok(!(Math.abs(p.x) < CRATE_HALF + 1 && Math.abs(p.z) < CRATE_HALF + 1));
  }
});
