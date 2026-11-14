import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LagSimulator, lagFromParams } from './lag.ts';
import { seededRng } from './rng.ts';

test('delivery keeps order and never beats half the delay', () => {
  const lag = new LagSimulator({ delayMs: 150, jitterMs: 50, stallChance: 0.05 }, seededRng(1));
  let last = -Infinity;
  for (let i = 0; i < 2000; i++) {
    const send = i * 33;
    const at = lag.deliveryTime(send);
    assert.ok(at >= last, 'reordered');
    assert.ok(at >= send + 75);
    last = at;
  }
});

test('query values are parsed and range-checked', () => {
  const get = (q: Record<string, string>) => (k: string) => q[k] ?? null;
  assert.deepEqual(lagFromParams(get({ lag: '150', jitter: '30' })), { delayMs: 150, jitterMs: 30, stallChance: 0 });
  assert.equal(lagFromParams(get({})), null);
  assert.equal(lagFromParams(get({ lag: '-5' })), null);
  assert.equal(lagFromParams(get({ stall: '2' })), null);
});
