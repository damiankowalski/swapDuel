import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  burstFade,
  distanceGain,
  isTeleport,
  POP_ANIM,
  popScale,
  sink,
  SINK_ANIM,
  THROW_ANIM,
  throwArm,
  waddle,
} from './anim.ts';

test('a standing snowman does not waddle', () => {
  for (const phase of [0, 1, 2, 3]) assert.deepEqual(waddle(phase, 0), { roll: 0, hop: 0, arm: 0 });
  const w = waddle(Math.PI / 2, 1);
  assert.ok(w.roll > 0.1 && w.hop > 0.05 && w.arm > 0.4);
});

test('the throwing arm winds up behind, whips forward and comes back down', () => {
  assert.equal(throwArm(-0.1), 0);
  assert.equal(throwArm(THROW_ANIM), 0);
  assert.ok(throwArm(THROW_ANIM * 0.3) < -2.5, 'wound up behind the head');
  assert.ok(throwArm(THROW_ANIM * 0.55) > 1.7, 'released in front');
  assert.ok(Math.abs(throwArm(THROW_ANIM * 0.999)) < 0.01, 'settled');
});

test('a respawned snowman pops in small, overshoots a little and ends at full size', () => {
  assert.equal(popScale(-1), 0.2);
  assert.ok(Math.abs(popScale(0) - 0.2) < 1e-9);
  const peak = Math.max(...Array.from({ length: 50 }, (_, i) => popScale((i / 50) * POP_ANIM)));
  assert.ok(peak > 1 && peak < 1.25, `overshoot ${peak}`);
  assert.equal(popScale(POP_ANIM), 1);
});

test('falling into the ditch sinks and shrinks, monotonically', () => {
  assert.deepEqual(sink(0), { drop: 0, scale: 1 });
  let prev = sink(0);
  for (let t = 0.05; t <= SINK_ANIM + 0.2; t += 0.05) {
    const s = sink(t);
    assert.ok(s.drop >= prev.drop && s.scale <= prev.scale);
    prev = s;
  }
  assert.ok(prev.drop > 2 && prev.scale < 0.5);
});

test('bursts fade out', () => {
  assert.equal(burstFade(0), 1);
  assert.ok(burstFade(0.2) > 0 && burstFade(0.2) < 1);
  assert.equal(burstFade(10), 0);
});

test('a respawn jump is a teleport, a frame of walking is not', () => {
  assert.equal(isTeleport(0, 0, 0.2, 0.1), false);
  assert.equal(isTeleport(0, 6, 3, -5), true);
});

test('sounds get quieter with distance', () => {
  assert.equal(distanceGain(0), 1);
  assert.ok(distanceGain(6) === 0.5);
  assert.ok(distanceGain(30) < distanceGain(10));
  assert.equal(distanceGain(-5), 1);
});
