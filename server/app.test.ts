// End-to-end tests over real sockets: the HTTP surface, the upgrade checks, the handshake, limits and a match.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import { KEY_FORWARD, parseServerMessage, PROTOCOL_VERSION, type ServerMessage } from '../shared/protocol.ts';
import { createGameServer, type GameServer } from './app.ts';
import { DEFAULTS, type Config } from './config.ts';

const distDir = mkdtempSync(join(tmpdir(), 'swapduel-test-'));
writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>t</title><script type="module">console.log(1)</script>');

async function start(overrides: Partial<Config> = {}): Promise<{ game: GameServer; port: number; origin: string }> {
  const config: Config = {
    ...DEFAULTS,
    port: 0,
    allowedOrigins: ['http://test.local'],
    distDir,
    log: false,
    handshakeTimeoutMs: 300,
    countdownSeconds: 0,
    ...overrides,
  };
  const game = createGameServer(config);
  const port = await game.listen();
  return { game, port, origin: 'http://test.local' };
}

interface TestClient {
  ws: WebSocket;
  inbox: ServerMessage[];
  next<T extends ServerMessage['t']>(t: T, timeoutMs?: number): Promise<Extract<ServerMessage, { t: T }>>;
  closed: Promise<{ code: number; reason: string }>;
  send(obj: unknown): void;
}

function connect(port: number, origin: string, headers: Record<string, string> = {}): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers });
    const inbox: ServerMessage[] = [];
    const waiters: Array<() => void> = [];
    ws.on('message', (data) => {
      const msg = parseServerMessage(data.toString());
      assert.ok(msg, `server sent an invalid message: ${data.toString()}`);
      inbox.push(msg);
      for (const w of waiters.splice(0)) w();
    });
    const closed = new Promise<{ code: number; reason: string }>((res) =>
      ws.on('close', (code, reason) => res({ code, reason: reason.toString() })),
    );
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', (err) => reject(err));
    ws.on('open', () =>
      resolve({
        ws,
        inbox,
        closed,
        send: (obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
        next(t, timeoutMs = 2000) {
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`no "${t}" within ${timeoutMs} ms`)), timeoutMs);
            const check = () => {
              const i = inbox.findIndex((m) => m.t === t);
              if (i >= 0) {
                clearTimeout(timer);
                res(inbox.splice(i, 1)[0] as never);
              } else waiters.push(check);
            };
            check();
          });
        },
      }),
    );
  });
}

async function hello(c: TestClient): Promise<void> {
  c.send({ t: 'hello', v: PROTOCOL_VERSION });
  await c.next('welcome');
}

async function status(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/status`);
  return ((await res.json()) as { state: string }).state;
}

describe('HTTP surface', () => {
  let s: Awaited<ReturnType<typeof start>>;
  before(async () => (s = await start()));
  after(() => s.game.close());

  test('GET / serves the client with a strict CSP', async () => {
    const res = await fetch(`http://127.0.0.1:${s.port}/`);
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('GET /status says free or busy and nothing else', async () => {
    const res = await fetch(`http://127.0.0.1:${s.port}/status`);
    assert.deepEqual(await res.json(), { state: 'free', protocol: PROTOCOL_VERSION });
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  test('other paths and methods are refused', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/../etc/passwd`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/dist/index.html`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${s.port}/`, { method: 'POST' })).status, 405);
  });
});

describe('WebSocket upgrade and handshake', () => {
  let s: Awaited<ReturnType<typeof start>>;
  before(async () => (s = await start()));
  after(() => s.game.close());

  test('a foreign Origin is refused with 403', async () => {
    await assert.rejects(connect(s.port, 'https://evil.example'), /HTTP 403/);
    await assert.rejects(connect(s.port, ''), /HTTP 403/);
  });

  test('hello with the right version gets welcome', async () => {
    const c = await connect(s.port, s.origin);
    c.send({ t: 'hello', v: PROTOCOL_VERSION });
    assert.deepEqual(await c.next('welcome'), { t: 'welcome', v: PROTOCOL_VERSION, hz: 30 });
    c.ws.close();
  });

  test('a different protocol version is rejected', async () => {
    const c = await connect(s.port, s.origin);
    c.send({ t: 'hello', v: PROTOCOL_VERSION + 1 });
    assert.deepEqual(await c.next('reject'), { t: 'reject', reason: 'version' });
    assert.equal((await c.closed).code, 1000);
  });

  test('no hello in time closes the socket', async () => {
    const c = await connect(s.port, s.origin);
    assert.deepEqual(await c.next('reject'), { t: 'reject', reason: 'timeout' });
    assert.equal((await c.closed).code, 1008);
  });

  for (const [name, payload, code] of [
    ['an unknown message type', { t: 'teleport', x: 0 }, 1008],
    ['invalid JSON', '{nope', 1008],
    ['a message before hello', { t: 'create' }, 1008],
    ['an oversized frame', JSON.stringify({ t: 'hello', v: 1, pad: 'x'.repeat(2000) }), 1009],
  ] as const) {
    test(`${name} closes the socket`, async () => {
      const c = await connect(s.port, s.origin);
      c.send(payload);
      assert.equal((await c.closed).code, code);
    });
  }

  test('a binary frame closes the socket', async () => {
    const c = await connect(s.port, s.origin);
    c.ws.send(Buffer.from([1, 2, 3]));
    assert.equal((await c.closed).code, 1003);
  });

  test('five wrong room codes close the socket', async () => {
    const c = await connect(s.port, s.origin);
    await hello(c);
    for (let i = 0; i < 5; i++) c.send({ t: 'join', code: 'ZZZZZ' });
    for (let i = 0; i < 4; i++) assert.deepEqual(await c.next('reject'), { t: 'reject', reason: 'bad_code' });
    assert.equal((await c.closed).code, 1008);
  });
});

describe('connection limits', () => {
  test('per-IP cap uses the trusted header; a missing header is refused', async () => {
    const s = await start({ clientIpHeader: 'x-client-ip', maxConnectionsPerIp: 2 });
    try {
      const a = await connect(s.port, s.origin, { 'x-client-ip': '203.0.113.1' });
      const b = await connect(s.port, s.origin, { 'x-client-ip': '203.0.113.1' });
      await assert.rejects(connect(s.port, s.origin, { 'x-client-ip': '203.0.113.1' }), /HTTP 503/);
      const c = await connect(s.port, s.origin, { 'x-client-ip': '203.0.113.2' });
      await assert.rejects(connect(s.port, s.origin), /HTTP 400/);
      // A closed socket frees its slot.
      a.ws.close();
      await a.closed;
      await new Promise((r) => setTimeout(r, 50));
      const d = await connect(s.port, s.origin, { 'x-client-ip': '203.0.113.1' });
      for (const x of [b, c, d]) x.ws.close();
    } finally {
      await s.game.close();
    }
  });

  test('pending handshakes are capped', async () => {
    const s = await start({ maxPendingHandshakes: 2, handshakeTimeoutMs: 5000 });
    try {
      const a = await connect(s.port, s.origin);
      const b = await connect(s.port, s.origin);
      await assert.rejects(connect(s.port, s.origin), /HTTP 503/);
      await hello(a); // finishing a handshake frees a pending slot
      const c = await connect(s.port, s.origin);
      for (const x of [a, b, c]) x.ws.close();
    } finally {
      await s.game.close();
    }
  });
});

describe('rooms and a match over sockets', () => {
  test('host + guest play; a third player is refused; leaving frees the server', async () => {
    const s = await start();
    try {
      assert.equal(await status(s.port), 'free');
      const host = await connect(s.port, s.origin);
      await hello(host);
      host.send({ t: 'create' });
      const room = await host.next('room');
      assert.equal(room.seat, 0);
      assert.equal(await status(s.port), 'busy');

      const third = await connect(s.port, s.origin);
      await hello(third);
      third.send({ t: 'create' });
      assert.deepEqual(await third.next('reject'), { t: 'reject', reason: 'busy' });

      const guest = await connect(s.port, s.origin);
      await hello(guest);
      guest.send({ t: 'join', code: room.code });
      assert.equal((await guest.next('room')).seat, 1);
      const start0 = await guest.next('start');
      await host.next('start');

      third.send({ t: 'join', code: room.code });
      assert.deepEqual(await third.next('reject'), { t: 'reject', reason: 'full' });

      // The guest walks forward; the server moves it and acknowledges the inputs.
      for (let i = 0; i < 9; i++) guest.send({ t: 'in', s: i, k: KEY_FORWARD });
      let snap = await guest.next('snap');
      for (let i = 0; i < 20 && snap.ack < 8; i++) snap = await guest.next('snap');
      assert.equal(snap.ack, 8);
      // Nine inputs sent at once: only the newest four are kept (no banking of moves), 4 x 0.2 m.
      assert.ok(Math.abs(Math.abs(snap.you.z - start0.you.z) - 0.8) < 1e-6, `guest moved to ${snap.you.z}`);
      const hostView = await host.next('snap');
      assert.ok(Math.abs(hostView.opp.z - start0.you.z) > 0.1, 'host sees the guest move');

      // Repeating a sequence number is a protocol violation.
      guest.send({ t: 'in', s: 3, k: 0 });
      assert.equal((await guest.closed).code, 1008);
      assert.deepEqual(await host.next('end'), { t: 'end', reason: 'opponent_left' });
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(await status(s.port), 'free');
      third.ws.close();
    } finally {
      await s.game.close();
    }
  });

  test('flooding inputs trips the rate limit', async () => {
    const s = await start();
    try {
      const host = await connect(s.port, s.origin);
      await hello(host);
      host.send({ t: 'create' });
      const room = await host.next('room');
      const guest = await connect(s.port, s.origin);
      await hello(guest);
      guest.send({ t: 'join', code: room.code });
      await guest.next('start');
      for (let i = 0; i < 60; i++) guest.send({ t: 'in', s: i, k: 0 });
      assert.equal((await guest.closed).code, 1008);
      host.ws.close();
    } finally {
      await s.game.close();
    }
  });

  test('a waiting room expires', async () => {
    const s = await start({ waitingRoomTimeoutMs: 200 });
    try {
      const host = await connect(s.port, s.origin);
      await hello(host);
      host.send({ t: 'create' });
      await host.next('room');
      assert.deepEqual(await host.next('end'), { t: 'end', reason: 'room_expired' });
      assert.equal((await host.closed).code, 1000);
      assert.equal(await status(s.port), 'free');
    } finally {
      await s.game.close();
    }
  });
});
