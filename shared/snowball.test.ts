import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AMMO_INTERVAL, SNOWBALL_RADIUS, START_AMMO, THROW_COOLDOWN } from './constants.ts';
import {
  createThrower,
  hitsFighter,
  hitsWorld,
  landingPoint,
  launch,
  positionAt,
  pressFire,
  secondsToNextSnowball,
  stepSnowball,
  tickThrower,
  type Snowball,
} from './snowball.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function ball(from: { x: number; z: number }, yaw: number): Snowball {
  const s = launch(from, yaw);
  return { id: 1, owner: 0, pos: s.pos, vel: s.vel, age: 0 };
}

test('players start with 5 snowballs and get one more every 10 s, without a cap', () => {
  const t = createThrower();
  assert.equal(t.ammo, START_AMMO);
  tickThrower(t, 9.9);
  assert.equal(t.ammo, 5);
  tickThrower(t, 0.1);
  assert.equal(t.ammo, 6);
  for (let i = 0; i < 600; i++) tickThrower(t, 1); // 10 minutes
  assert.equal(t.ammo, 66);
  near(secondsToNextSnowball(t), AMMO_INTERVAL);
});

test('a finite cap stops the stock and the refill timer', () => {
  const t = createThrower();
  for (let i = 0; i < 100; i++) tickThrower(t, 1, 7);
  assert.equal(t.ammo, 7);
  assert.equal(secondsToNextSnowball(t, 7), 0);
});

test('each press throws one snowball; holding the key does not repeat', () => {
  const t = createThrower();
  assert.equal(pressFire(t, true), true);
  assert.equal(t.ammo, START_AMMO - 1);
  tickThrower(t, 1);
  assert.equal(pressFire(t, true), false, 'still held');
  assert.equal(pressFire(t, false), false);
  assert.equal(pressFire(t, true), true, 'new press');
});

test('throws are at least THROW_COOLDOWN apart and need ammo', () => {
  const t = createThrower();
  assert.equal(pressFire(t, true), true);
  pressFire(t, false);
  tickThrower(t, THROW_COOLDOWN / 2);
  assert.equal(pressFire(t, true), false, 'too soon');
  t.ammo = 0;
  t.cooldown = 0;
  pressFire(t, false);
  assert.equal(pressFire(t, true), false, 'no ammo');
});

test('a snowball follows the exact ballistic arc and has about 18 m of range on flat ground', () => {
  const start = launch({ x: 0, z: 8 }, Math.PI / 2); // faces -x along z = 8
  const b: Snowball = { id: 1, owner: 0, pos: { ...start.pos }, vel: { ...start.vel }, age: 0 };
  let impact = null;
  for (let i = 0; i < 300 && !impact; i++) impact = stepSnowball(b, 1 / 30, []);
  const exact = positionAt(start.pos, start.vel, b.age);
  near(b.pos.x, exact.x);
  near(b.pos.y, exact.y);
  assert.equal(impact?.kind, 'world');
  assert.ok(impact && impact.point.x < -9.4, 'the 20 m arena is shorter than the range: it reaches the wall');
  // Range on open flat ground, from the launch values.
  const vy = start.vel.y;
  const fall = (vy + Math.sqrt(vy * vy + 2 * 9.81 * (start.pos.y - SNOWBALL_RADIUS))) / 9.81;
  const range = Math.hypot(start.vel.x, start.vel.z) * fall;
  assert.ok(range > 17 && range < 19.5, `range ${range}`);
});

test('the reticle point is where the arc meets the world', () => {
  const p = landingPoint({ x: 0, z: 8 }, Math.PI / 2);
  assert.ok(hitsWorld(p));
});

test('a snowball thrown at a fighter 8 m away hits it', () => {
  const b = ball({ x: 5, z: 6 }, 0); // faces -z
  let impact = null;
  for (let i = 0; i < 300 && !impact; i++) impact = stepSnowball(b, 1 / 30, [{ seat: 1, pos: { x: 5, z: -2 } }]);
  assert.equal(impact?.kind, 'target');
  assert.ok(impact && impact.kind === 'target' && impact.seat === 1);
});

test('a snowball passing 1 m beside a fighter misses', () => {
  const b = ball({ x: 5, z: 6 }, 0);
  let impact = null;
  for (let i = 0; i < 300 && !impact; i++) impact = stepSnowball(b, 1 / 30, [{ seat: 1, pos: { x: 6, z: -2 } }]);
  assert.equal(impact?.kind, 'world');
});

test('the crate stops snowballs', () => {
  const b = ball({ x: 0, z: 6 }, 0); // straight at the crate
  let impact = null;
  for (let i = 0; i < 300 && !impact; i++) impact = stepSnowball(b, 1 / 30, [{ seat: 1, pos: { x: 0, z: -6 } }]);
  assert.equal(impact?.kind, 'world');
  assert.ok(impact && impact.point.z > 1.4 && impact.point.z < 1.7, `stopped at z ${impact?.point.z}`);
});

test('hit shapes: body capsule and head', () => {
  assert.equal(hitsFighter({ x: 0.55, y: 1.0, z: 0 }, { x: 0, z: 0 }), true);
  assert.equal(hitsFighter({ x: 0.65, y: 1.0, z: 0 }, { x: 0, z: 0 }), false);
  assert.equal(hitsFighter({ x: 0, y: 2.1, z: 0 }, { x: 0, z: 0 }), true);
  assert.equal(hitsFighter({ x: 0, y: 2.3, z: 0 }, { x: 0, z: 0 }), false);
});
