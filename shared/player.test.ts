import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARENA_HALF, MOVE_SPEED, PLAYER_RADIUS, TURN_SPEED } from './constants.ts';
import { NO_INPUT, stepPlayer, type PlayerState } from './player.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const fresh = (): PlayerState => ({ pos: { x: 0, z: 6 }, yaw: 0, pitch: 0 });

test('forward at yaw 0 moves towards -z at MOVE_SPEED', () => {
  const p = fresh();
  stepPlayer(p, { ...NO_INPUT, forward: true }, 0.1);
  near(p.pos.x, 0);
  near(p.pos.z, 6 - MOVE_SPEED * 0.1);
});

test('strafing right at yaw 0 moves towards +x', () => {
  const p = fresh();
  stepPlayer(p, { ...NO_INPUT, right: true }, 0.1);
  near(p.pos.x, MOVE_SPEED * 0.1);
  near(p.pos.z, 6);
});

test('diagonal movement is not faster', () => {
  const p = fresh();
  stepPlayer(p, { ...NO_INPUT, forward: true, right: true }, 0.1);
  near(Math.hypot(p.pos.x, p.pos.z - 6), MOVE_SPEED * 0.1);
});

test('opposite keys cancel out', () => {
  const p = fresh();
  stepPlayer(p, { ...NO_INPUT, forward: true, back: true }, 0.1);
  assert.deepEqual(p.pos, { x: 0, z: 6 });
});

test('turning left increases yaw, then movement follows the new heading', () => {
  const p = fresh();
  stepPlayer(p, { ...NO_INPUT, turnLeft: true, forward: true }, Math.PI / 2 / TURN_SPEED);
  near(p.yaw, Math.PI / 2);
  // yaw +90 degrees faces -x.
  assert.ok(p.pos.x < 0);
  near(p.pos.z, 6);
});

test('walls stop the fighter', () => {
  const p = fresh();
  for (let i = 0; i < 100; i++) stepPlayer(p, { ...NO_INPUT, back: true }, 0.05);
  near(p.pos.z, ARENA_HALF - PLAYER_RADIUS);
});
