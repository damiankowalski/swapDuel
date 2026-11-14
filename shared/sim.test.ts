import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMatch } from './sim.ts';

test('a headless 2-minute bot match keeps everyone in valid positions', () => {
  const r = runMatch({ seconds: 120, seed: 1 });
  assert.equal(r.invalidPositions, 0);
  assert.equal(r.steps, 120 * 60);
  // Fire every 0.12 s rounds up to every 8th 60 fps step: 900 shots in 120 s.
  assert.deepEqual(r.shots, [900, 900]);
  assert.ok(r.hits[0] + r.hits[1] > 0, 'random bots should land at least one hit in 2 minutes');
});

test('the same seed gives the same match', () => {
  assert.deepEqual(runMatch({ seconds: 30, seed: 9 }), runMatch({ seconds: 30, seed: 9 }));
});
