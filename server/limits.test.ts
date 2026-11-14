import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionLimiter, TokenBucket } from './limits.ts';

test('a token bucket allows its burst, then its rate', () => {
  const b = new TokenBucket(3, 10, 0);
  assert.deepEqual([b.take(0), b.take(0), b.take(0), b.take(0)], [true, true, true, false]);
  assert.equal(b.take(50), false); // half a token
  assert.equal(b.take(100), true);
});

test('connections are capped per IP and in total, and released', () => {
  const l = new ConnectionLimiter(3, 2);
  assert.equal(l.admit('a'), 'ok');
  assert.equal(l.admit('a'), 'ok');
  assert.equal(l.admit('a'), 'too_many_from_ip');
  assert.equal(l.admit('b'), 'ok');
  assert.equal(l.admit('c'), 'too_many');
  l.release('a');
  assert.equal(l.admit('c'), 'ok');
  assert.equal(l.open, 3);
});
