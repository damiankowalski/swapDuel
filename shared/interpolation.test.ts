import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_DELAY, SnapshotInterpolator } from './interpolation.ts';
import { TICK_DT } from './protocol.ts';

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('renders between snapshots, MIN_DELAY behind the newest', () => {
  const it = new SnapshotInterpolator();
  // Perfect network: snapshot n arrives exactly at n * TICK_DT; the fighter moves 1 m per tick on x.
  for (let n = 0; n <= 20; n++) it.push(n, { x: n, z: 0, yaw: 0 }, false, n * TICK_DT);
  const s = it.sample(20 * TICK_DT)!;
  near(s.pose.x, 20 - MIN_DELAY / TICK_DT);
  assert.equal(s.extrapolating, false);
});

test('yaw is interpolated the short way across +-PI', () => {
  const it = new SnapshotInterpolator();
  it.push(0, { x: 0, z: 0, yaw: 3.1 }, false, 0);
  it.push(1, { x: 0, z: 0, yaw: -3.1 }, false, TICK_DT);
  it.push(10, { x: 0, z: 0, yaw: -3.1 }, false, 10 * TICK_DT);
  const s = it.sample(0.5 * TICK_DT + MIN_DELAY)!;
  assert.ok(Math.abs(s.pose.yaw) > 3.1, `went the long way: ${s.pose.yaw}`);
});

test('a teleport is not interpolated and reports a cut once', () => {
  const it = new SnapshotInterpolator();
  for (let n = 0; n <= 5; n++) it.push(n, { x: 0, z: 0, yaw: 0 }, false, n * TICK_DT);
  it.push(6, { x: 8, z: 8, yaw: 0 }, true, 6 * TICK_DT);
  for (let n = 7; n <= 12; n++) it.push(n, { x: 8, z: 8, yaw: 0 }, false, n * TICK_DT);
  const before = it.sample(5.5 * TICK_DT + MIN_DELAY)!;
  assert.deepEqual([before.pose.x, before.cut], [0, false]);
  const after = it.sample(6.2 * TICK_DT + MIN_DELAY)!;
  assert.equal(after.cut, true);
  near(after.pose.x, 8);
  assert.equal(it.sample(6.4 * TICK_DT + MIN_DELAY)!.cut, false);
});

test('a starved buffer extrapolates at most 100 ms, then holds, and counts the starvation', () => {
  const it = new SnapshotInterpolator();
  for (let n = 0; n <= 10; n++) it.push(n, { x: n * 0.1, z: 0, yaw: 0 }, false, n * TICK_DT);
  const far = it.sample(10 * TICK_DT + MIN_DELAY + 1)!; // one second after the last snapshot
  assert.equal(far.extrapolating, true);
  near(far.pose.x, 1.0 + 0.1 * (0.1 / TICK_DT));
  assert.equal(it.starvations, 1);
});

test('the delay grows with jitter, slowly', () => {
  const it = new SnapshotInterpolator();
  let t = 0;
  for (let n = 0; n < 300; n++) {
    t = n * TICK_DT + (n % 2 === 0 ? 0 : 0.1); // 100 ms alternating jitter
    it.push(n, { x: 0, z: 0, yaw: 0 }, false, t);
    it.sample(t);
  }
  assert.ok(it.targetDelay > MIN_DELAY, `target ${it.targetDelay}`);
  assert.ok(it.delay > MIN_DELAY && it.delay <= it.targetDelay + 1e-9);
});
