import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeerMessage } from './p2p-protocol.ts';

test('well-formed messages pass', () => {
  assert.deepEqual(parsePeerMessage({ t: 's', x: 1, z: -2, y: 3.5 }), { t: 's', x: 1, z: -2, y: 3.5 });
  assert.deepEqual(parsePeerMessage({ t: 'hit' }), { t: 'hit' });
  const shot = { t: 'shot', ox: 0, oy: 1.5, oz: 5, ex: 0, ey: 1.6, ez: -50 };
  assert.deepEqual(parsePeerMessage(shot), shot);
});

test('extra fields are dropped', () => {
  assert.deepEqual(parsePeerMessage({ t: 's', x: 1, z: 2, y: 0, evil: true }), { t: 's', x: 1, z: 2, y: 0 });
});

test('malformed messages are refused', () => {
  for (const bad of [
    null, 42, 'hit', [], {}, { t: 'nope' },
    { t: 's', x: Number.NaN, z: 0, y: 0 },
    { t: 's', x: 1e9, z: 0, y: 0 },
    { t: 's', x: '1', z: 0, y: 0 },
    { t: 's', x: 0, z: 0 },
    { t: 'shot', ox: 0, oy: 0, oz: 0, ex: 0, ey: Infinity, ez: 0 },
  ]) {
    assert.equal(parsePeerMessage(bad), null, JSON.stringify(bad));
  }
});
