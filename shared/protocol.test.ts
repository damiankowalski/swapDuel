import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseClientMessage, parseServerMessage, parseStatus, KEY_MASK, MAX_SEQ } from './protocol.ts';

test('valid client messages pass', () => {
  assert.deepEqual(parseClientMessage('{"t":"hello","v":1}'), { t: 'hello', v: 1 });
  assert.deepEqual(parseClientMessage('{"t":"create"}'), { t: 'create' });
  assert.deepEqual(parseClientMessage('{"t":"join","code":"AB2CZ"}'), { t: 'join', code: 'AB2CZ' });
  assert.deepEqual(parseClientMessage(`{"t":"in","s":${MAX_SEQ},"k":${KEY_MASK}}`), { t: 'in', s: MAX_SEQ, k: KEY_MASK });
  assert.deepEqual(parseClientMessage('{"t":"leave"}'), { t: 'leave' });
});

test('anything else from a client is refused', () => {
  for (const bad of [
    '', 'nope', '[]', 'null', '42', '{}', '{"t":"x"}',
    '{"t":"hello"}', '{"t":"hello","v":1.5}', '{"t":"hello","v":"1"}', '{"t":"hello","v":1,"x":1}',
    '{"t":"create","code":"AB2CZ"}',
    '{"t":"join","code":"ab2cz"}', '{"t":"join","code":"AB0CZ"}', '{"t":"join","code":"AB2CZZ"}', '{"t":"join"}',
    '{"t":"in","s":-1,"k":0}', '{"t":"in","s":0,"k":128}', '{"t":"in","s":0.5,"k":0}', '{"t":"in","s":0}',
    `{"t":"in","s":${MAX_SEQ + 1},"k":0}`,
    '{"t":"in","s":1e400,"k":0}',
    '{"__proto__":{"t":"create"}}',
    '{"t":"create","__proto__":{"x":1}}',
    'x'.repeat(2000),
  ]) {
    assert.equal(parseClientMessage(bad), null, bad.slice(0, 60));
  }
});

test('server messages are validated by the client too', () => {
  const snap = {
    t: 'snap', tick: 5, ack: 3,
    you: { x: 1, z: 2, yaw: 0.5 }, opp: { x: -1, z: -2, yaw: -3 },
    score: [1, 0],
    ev: [{ k: 'shot', by: 'you', from: [0, 1.5, 0], to: [0, 1.6, -60] }, { k: 'hit', by: 'opp' }, { k: 'spawn', who: 'you', x: 3, z: 4 }],
  };
  assert.deepEqual(parseServerMessage(JSON.stringify(snap)), snap);
  assert.equal(parseServerMessage(JSON.stringify({ ...snap, you: { x: 1e9, z: 0, yaw: 0 } })), null);
  assert.equal(parseServerMessage(JSON.stringify({ ...snap, ev: [{ k: 'boom' }] })), null);
  assert.deepEqual(parseServerMessage('{"t":"reject","reason":"busy"}'), { t: 'reject', reason: 'busy' });
  assert.equal(parseServerMessage('{"t":"reject","reason":"whatever"}'), null);
  assert.deepEqual(parseServerMessage('{"t":"end","reason":"room_expired"}'), { t: 'end', reason: 'room_expired' });
});

test('status responses are validated', () => {
  assert.deepEqual(parseStatus({ state: 'busy', protocol: 1 }), { state: 'busy', protocol: 1 });
  assert.equal(parseStatus({ state: 'maybe', protocol: 1 }), null);
});
