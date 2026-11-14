import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

test('defaults are local and safe', () => {
  const c = loadConfig({}, '/dist');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 8080);
  assert.equal(c.maxRooms, 1);
  assert.equal(c.clientIpHeader, null);
  assert.ok(c.allowedOrigins.includes('http://127.0.0.1:8080'));
  assert.equal(c.waitingRoomTimeoutMs, 180_000);
  assert.equal(c.matchMaxMs, 1_200_000);
});

test('a public bind needs explicit origins', () => {
  assert.throws(() => loadConfig({ HOST: '0.0.0.0' }, '/dist'), /ALLOWED_ORIGINS/);
  const c = loadConfig({ HOST: '0.0.0.0', ALLOWED_ORIGINS: 'https://game.example', CLIENT_IP_HEADER: 'CF-Connecting-IP' }, '/dist');
  assert.deepEqual(c.allowedOrigins, ['https://game.example']);
  assert.equal(c.clientIpHeader, 'cf-connecting-ip');
});

test('bad values are refused', () => {
  assert.throws(() => loadConfig({ PORT: 'abc' }, '/dist'));
  assert.throws(() => loadConfig({ MAX_ROOMS: '0' }, '/dist'));
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: 'https://game.example/path' }, '/dist'));
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: 'ftp://game.example' }, '/dist'));
  assert.throws(() => loadConfig({ CLIENT_IP_HEADER: 'bad header' }, '/dist'));
});
