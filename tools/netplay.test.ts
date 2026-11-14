// The CAMERA requirement of P2 (docs/NETWORKING.md §12), measured headlessly over 2-minute matches.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runNetplay } from './netplay.ts';

const SEEDS = [1, 2, 3];

test('150 ms +- 30 ms: the camera is smooth, far smoother than v0.1.0, with rare short starvations', () => {
  for (const seed of SEEDS) {
    const r = runNetplay({ seconds: 120, seed, lag: { delayMs: 150, jitterMs: 30, stallChance: 0 } });
    const at = `seed ${seed}: ${JSON.stringify(r)}`;
    assert.ok(r.jitterRatio <= 1.0, `camera shakier than the real motion; ${at}`);
    assert.ok(r.camera.maxYawStepExcess <= 1.5, `yaw jump; ${at}`);
    assert.ok(r.camera.maxPosStepExcess <= 0.1, `position jump; ${at}`);
    assert.ok(r.camera.yawJerkRms <= r.naive.yawJerkRms / 2, `not better than v0.1.0; ${at}`);
    assert.ok(r.starvations <= 10, `too many starvations; ${at}`);
  }
});

test('150 ms +- 50 ms with 2% stalls of 200 ms: no camera jump above 5 degrees', () => {
  for (const seed of SEEDS) {
    const r = runNetplay({ seconds: 120, seed, lag: { delayMs: 150, jitterMs: 50, stallChance: 0.02 } });
    const at = `seed ${seed}: ${JSON.stringify(r)}`;
    assert.ok(r.camera.maxYawStepExcess <= 5, `yaw jump; ${at}`);
    assert.ok(r.jitterRatio <= 1.2, `shaky; ${at}`);
    assert.ok(r.camera.maxYawStepExcess < r.naive.maxYawStepExcess, `not better than v0.1.0; ${at}`);
  }
});

test('300 ms +- 80 ms: still smooth', () => {
  for (const seed of SEEDS) {
    const r = runNetplay({ seconds: 120, seed, lag: { delayMs: 300, jitterMs: 80, stallChance: 0 } });
    assert.ok(r.camera.maxYawStepExcess <= 2 && r.jitterRatio <= 1.0, `seed ${seed}: ${JSON.stringify(r)}`);
  }
});

test('no lag: no starvation and the minimum delay', () => {
  const r = runNetplay({ seconds: 60, seed: 1, lag: { delayMs: 0, jitterMs: 0, stallChance: 0 } });
  assert.equal(r.starvations, 0);
  assert.equal(Math.round(r.finalDelayMs), 100);
});
