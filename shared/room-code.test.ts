import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoomCode, parseRoomCode, ROOM_CODE_ALPHABET } from './room-code.ts';
import { seededRng } from './rng.ts';

test('codes have 5 characters from the alphabet', () => {
  const rng = seededRng(1);
  for (let i = 0; i < 1000; i++) {
    const code = createRoomCode((max) => Math.floor(rng() * max));
    assert.match(code, /^[a-z0-9]{5}$/);
  }
});

test('every position, including the first, varies (v0.1.0 always started with 0)', () => {
  const rng = seededRng(2);
  const first = new Set<string>();
  for (let i = 0; i < 1000; i++) first.add(createRoomCode((max) => Math.floor(rng() * max))[0]!);
  assert.ok(first.size > 20, `only ${first.size} different first characters`);
  assert.equal(ROOM_CODE_ALPHABET.length, 36);
});

test('typed codes are trimmed and lower-cased; anything else is refused', () => {
  assert.equal(parseRoomCode('  AB12Z '), 'ab12z');
  assert.equal(parseRoomCode('ab1'), null);
  assert.equal(parseRoomCode('ab12z9'), null);
  assert.equal(parseRoomCode('ab-2z'), null);
});
