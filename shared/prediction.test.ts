import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyInput } from './netsim.ts';
import type { PlayerState } from './player.ts';
import { Predictor } from './prediction.ts';
import { KEY_FORWARD, KEY_TURN_LEFT } from './protocol.ts';

const start = { x: 0, z: 6, yaw: 0 };

test('with a perfect server, reconciliation changes nothing', () => {
  const p = new Predictor(start);
  const server: PlayerState = { pos: { x: 0, z: 6 }, yaw: 0, pitch: 0 };
  const sent = [];
  for (let i = 0; i < 10; i++) sent.push(p.step(i % 3 === 0 ? KEY_FORWARD | KEY_TURN_LEFT : KEY_FORWARD));
  // The server has processed the first 6 inputs.
  for (const input of sent.slice(0, 6)) applyInput(server, input.k);
  const before = { ...p.state.pos };
  const error = p.reconcile(5, { x: server.pos.x, z: server.pos.z, yaw: server.yaw });
  assert.ok(error < 1e-9);
  assert.deepEqual(p.state.pos, before);
  assert.equal(p.pendingCount, 4);
});

test('a small server correction is applied to the state but faded on screen', () => {
  const p = new Predictor(start);
  p.step(KEY_FORWARD);
  const predicted = { ...p.state.pos };
  const error = p.reconcile(0, { x: 0.3, z: predicted.z, yaw: 0 });
  assert.ok(Math.abs(error - 0.3) < 1e-9);
  assert.equal(p.state.pos.x, 0.3);
  const drawn = p.render(1, 0);
  assert.ok(Math.abs(drawn.x - 0) < 1e-9, 'first frame still shows the old position');
  let last = drawn.x;
  for (let i = 0; i < 30; i++) last = p.render(1, 1 / 60).x;
  assert.ok(Math.abs(last - 0.3) < 0.01, `faded to the server position (${last})`);
});

test('a large correction (respawn) snaps', () => {
  const p = new Predictor(start);
  p.step(KEY_FORWARD);
  p.reconcile(0, { x: -7, z: -7, yaw: 1 });
  const drawn = p.render(0.5, 1 / 60);
  assert.deepEqual([drawn.x, drawn.z], [-7, -7]);
});
