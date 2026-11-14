import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMatch } from './sim.ts';

test('a headless 2-minute bot match stays valid and throws as the stock allows', () => {
  const r = runMatch({ seconds: 120, seed: 1 });
  assert.equal(r.invalid, 0);
  assert.equal(r.steps, 120 * 60);
  // One press a second: 5 at the start plus one at 10, 20, ... 110 s = 16 throws each.
  assert.deepEqual(r.throws, [16, 16]);
  assert.ok(r.inFlight <= 2);
});

test('the same seed gives the same match', () => {
  assert.deepEqual(runMatch({ seconds: 30, seed: 9 }), runMatch({ seconds: 30, seed: 9 }));
});
