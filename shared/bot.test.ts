import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidPosition } from './arena.ts';
import { createBot, respawnBot, stepBot } from './bot.ts';
import { seededRng } from './rng.ts';

test('the bot stays inside the arena and out of the crate for 10 minutes', () => {
  const rng = seededRng(7);
  const bot = createBot({ x: 0, z: -6 }, Math.PI);
  for (let i = 0; i < 60 * 60 * 10; i++) {
    stepBot(bot, 1 / 60, rng);
    assert.ok(isValidPosition(bot.pos), `invalid at step ${i}: ${JSON.stringify(bot.pos)}`);
    assert.ok(Number.isFinite(bot.lookYaw));
  }
});

test('the bot moves at most BOT_SPEED per second', () => {
  const rng = seededRng(3);
  const bot = createBot({ x: 0, z: -6 }, Math.PI);
  for (let i = 0; i < 600; i++) {
    const before = { ...bot.pos };
    stepBot(bot, 1 / 60, rng);
    assert.ok(Math.hypot(bot.pos.x - before.x, bot.pos.z - before.z) <= 2.6 / 60 + 1e-9);
  }
});

test('the same seed gives the same path', () => {
  const run = () => {
    const rng = seededRng(99);
    const bot = createBot({ x: 0, z: -6 }, Math.PI);
    for (let i = 0; i < 1000; i++) stepBot(bot, 1 / 60, rng);
    return bot;
  };
  assert.deepEqual(run(), run());
});

test('respawn puts the bot somewhere valid', () => {
  const rng = seededRng(5);
  const bot = createBot({ x: 0, z: -6 }, Math.PI);
  respawnBot(bot, rng);
  assert.ok(isValidPosition(bot.pos));
  assert.ok(isValidPosition(bot.target));
});
