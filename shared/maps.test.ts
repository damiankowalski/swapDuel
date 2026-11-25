import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inDitch, isValidPosition, randomSpawnPoint, resolveCollisions } from './arena.ts';
import { SPAWN_GUEST, SPAWN_HOST } from './constants.ts';
import { ditchEdge, isMapId, MAP_IDS, MAPS, MAX_ARENA_HALF } from './maps.ts';
import { seededRng } from './rng.ts';
import { hitsWorld } from './snowball.ts';
import { createBot, stepBot } from './bot.ts';
import { runMatch } from './sim.ts';

test('every arena has valid start positions and safe spawn points', () => {
  for (const id of MAP_IDS) {
    const map = MAPS[id];
    assert.ok(isValidPosition(SPAWN_HOST, map) && isValidPosition(SPAWN_GUEST, map), id);
    const rng = seededRng(3);
    for (let i = 0; i < 5000; i++) {
      const p = randomSpawnPoint(rng, map);
      assert.ok(isValidPosition(p, map), `${id}: ${JSON.stringify(p)}`);
      if (map.ditch > 0) assert.ok(Math.abs(p.x) <= ditchEdge(map) - 1 && Math.abs(p.z) <= ditchEdge(map) - 1);
    }
  }
  assert.equal(MAX_ARENA_HALF, 14);
  assert.ok(isMapId('moat') && !isMapId('lava'));
});

test('the moat: walking past the edge falls in; the classic arena has no ditch', () => {
  const moat = MAPS.moat;
  const edge = ditchEdge(moat); // 12.4
  assert.equal(inDitch({ x: edge + 0.2, z: 0 }, moat), false, 'standing on the brink is fine');
  assert.equal(inDitch({ x: edge + 0.4, z: 0 }, moat), true);
  assert.equal(inDitch({ x: 0, z: -(edge + 0.4) }, moat), true);
  assert.equal(inDitch({ x: 9.3, z: 0 }, MAPS.classic), false);
});

test('fighters collide with every crate of the moat', () => {
  const pos = { x: -6.2, z: 5.1 }; // inside the crate at (-6, 5)
  resolveCollisions(pos, MAPS.moat);
  assert.ok(isValidPosition(pos, MAPS.moat), JSON.stringify(pos));
});

test('snowballs fall into the ditch before they hit its floor, and hit the small crates', () => {
  const moat = MAPS.moat;
  assert.equal(hitsWorld({ x: 13, y: 0.1, z: 0 }, moat), false, 'over the ditch the floor is lower');
  assert.equal(hitsWorld({ x: 13, y: -1.1, z: 0 }, moat), true);
  assert.equal(hitsWorld({ x: 10, y: 0.1, z: 0 }, moat), true);
  assert.equal(hitsWorld({ x: 6, y: 1, z: -5 }, moat), true, 'small crate');
});

test('the bot never falls into the ditch in 10 minutes', () => {
  const rng = seededRng(5);
  const bot = createBot({ x: 0, z: -6 }, Math.PI);
  for (let i = 0; i < 60 * 600; i++) {
    stepBot(bot, 1 / 60, rng, { x: 3, z: 3 }, MAPS.moat);
    assert.ok(isValidPosition(bot.pos, MAPS.moat), `step ${i}: ${JSON.stringify(bot.pos)}`);
  }
});

test('a headless bot match on the moat stays valid', () => {
  const r = runMatch({ seconds: 120, seed: 4, map: MAPS.moat });
  assert.equal(r.invalid, 0);
});
