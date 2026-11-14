import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AngleFilter, CAMERA_YAW_FILTER, OneEuroFilter } from './one-euro.ts';
import { gaussian } from './lag.ts';
import { seededRng } from './rng.ts';

test('noise on a still value is strongly reduced', () => {
  const f = new OneEuroFilter(CAMERA_YAW_FILTER);
  const rng = seededRng(4);
  let rawVar = 0;
  let outVar = 0;
  f.filter(0, 1 / 60);
  for (let i = 0; i < 600; i++) {
    const v = gaussian(rng) * 0.01;
    const out = f.filter(v, 1 / 60);
    rawVar += v * v;
    outVar += out * out;
  }
  assert.ok(outVar < rawVar / 10, `raw ${rawVar}, filtered ${outVar}`);
});

test('a steady motion is followed with little lag', () => {
  const f = new OneEuroFilter(CAMERA_YAW_FILTER);
  let out = 0;
  for (let i = 0; i <= 120; i++) out = f.filter(i * 0.04, 1 / 60); // 2.4 rad/s turn
  assert.ok(Math.abs(out - 120 * 0.04) < 0.06, `lag ${120 * 0.04 - out}`);
});

test('angles crossing +-PI do not swing the long way', () => {
  const f = new AngleFilter(CAMERA_YAW_FILTER);
  f.filter(3.1, 1 / 60);
  const out = f.filter(-3.1, 1 / 60);
  assert.ok(Math.abs(out - 3.1) < 0.1, `jumped to ${out}`);
});
