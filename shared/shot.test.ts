import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BODY_RADIUS, CRATE_HALF, EYE_HEIGHT, SHOT_RANGE } from './constants.ts';
import { aimDirection } from './math.ts';
import { castShot, eyeOf, muzzleOf, rayAabb, raySphere } from './shot.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a shot straight at the opponent hits the body at eye height', () => {
  const r = castShot(eyeOf({ x: 5, z: 6 }), aimDirection(0, 0), { x: 5, z: -6 });
  assert.equal(r.hit, 'target');
  // At y = 1.6 the ray meets the capsule's top half-sphere (centre y 1.35, radius 0.45).
  const halfWidth = Math.sqrt(BODY_RADIUS ** 2 - (EYE_HEIGHT - 1.35) ** 2);
  near(r.point.z, -6 + halfWidth);
  near(r.point.y, EYE_HEIGHT);
});

test('the crate blocks a shot at an opponent behind it', () => {
  const r = castShot(eyeOf({ x: 0, z: 6 }), aimDirection(0, 0), { x: 0, z: -6 });
  assert.equal(r.hit, 'crate');
  near(r.point.z, CRATE_HALF);
});

test('a shot that passes beside the opponent misses and ends at SHOT_RANGE', () => {
  const r = castShot(eyeOf({ x: 5, z: 6 }), aimDirection(0, 0), { x: 5.5, z: -6 });
  assert.equal(r.hit, null);
  near(r.point.z, 6 - SHOT_RANGE);
});

test('the hit width at eye height is about 0.37 m each side', () => {
  const at = (dx: number) => castShot(eyeOf({ x: 5 + dx, z: 6 }), aimDirection(0, 0), { x: 5, z: -6 }).hit;
  assert.equal(at(0.37), 'target');
  assert.equal(at(-0.37), 'target');
  assert.equal(at(0.38), null);
});

test('a shot aimed away from the opponent misses', () => {
  const r = castShot(eyeOf({ x: 5, z: 6 }), aimDirection(Math.PI, 0), { x: 5, z: -6 });
  assert.equal(r.hit, null);
});

test('a looking-up shot can hit the head', () => {
  const origin = eyeOf({ x: 5, z: 0 });
  const dir = aimDirection(0, Math.atan2(1.75 - EYE_HEIGHT, 3));
  assert.equal(castShot(origin, dir, { x: 5, z: -3 }).hit, 'target');
});

test('shapes only count when the ray enters them', () => {
  assert.equal(raySphere({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, 1), Infinity);
  assert.equal(rayAabb({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, -1, 0, -1, 1, 2, 1), Infinity);
  near(raySphere({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, 1), 4);
});

test('the muzzle sits 1 m in front of the fighter, turned with its yaw', () => {
  const m0 = muzzleOf({ x: 0, z: 0 }, 0);
  near(m0.x, 0); near(m0.y, 1.5); near(m0.z, -1);
  const m90 = muzzleOf({ x: 0, z: 0 }, Math.PI / 2);
  near(m90.x, -1); near(m90.z, 0);
});
