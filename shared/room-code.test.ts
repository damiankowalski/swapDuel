import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoomCode, parseRoomCode, ROOM_CODE_ALPHABET } from './room-code.ts';
import { seededRng } from './rng.ts';

test('codes have 5 characters from the alphabet without look-alikes', () => {
  const rng = seededRng(1);
  for (let i = 0; i < 1000; i++) {
    const code = createRoomCode((max) => Math.floor(rng() * max));
    assert.match(code, /^[A-HJKMNP-Z2-9]{5}$/);
  }
  assert.equal(ROOM_CODE_ALPHABET.length, 31);
  assert.doesNotMatch(ROOM_CODE_ALPHABET, /[ILO01]/);
});

test('every position varies (v0.1.0 always started with 0)', () => {
  const rng = seededRng(2);
  const first = new Set<string>();
  for (let i = 0; i < 1000; i++) first.add(createRoomCode((max) => Math.floor(rng() * max))[0]!);
  assert.ok(first.size > 25, `only ${first.size} different first characters`);
});

test('typed codes are trimmed and upper-cased; anything else is refused', () => {
  assert.equal(parseRoomCode('  ab2cz '), 'AB2CZ');
  assert.equal(parseRoomCode('AB2'), null);
  assert.equal(parseRoomCode('AB2CZ9'), null);
  assert.equal(parseRoomCode('AB0CZ'), null);
  assert.equal(parseRoomCode('AB-CZ'), null);
});
