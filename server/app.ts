// HTTP + WebSocket front of the game server: serves the built client, GET /status and the WebSocket /ws.
// Every network input is untrusted: origin, limits and message schema are checked before anything else runs.
import { createHash, randomInt as cryptoRandomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, STATUS_CODES, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  TICK_RATE,
  type ServerMessage,
  type StatusResponse,
} from '../shared/protocol.ts';
import type { Config } from './config.ts';
import { ConnectionLimiter, TokenBucket } from './limits.ts';
import { RoomManager, type Player } from './rooms.ts';

const TICK_MS = 1000 / TICK_RATE;
/** Input messages: bursts of 10, about 40 per second sustained (the client sends 30). */
const INPUT_BURST = 10;
const INPUT_RATE = 40;
/** Everything else (hello, create, join, leave). */
const OTHER_BURST = 5;
const OTHER_RATE = 5;
const METRICS_INTERVAL_MS = 60_000;

export interface Metrics {
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  /** Upgrades refused and sockets closed, by reason. */
  refused: Record<string, number>;
  closed: Record<string, number>;
  maxTickMs: number;
}

export interface GameServer {
  readonly server: Server;
  readonly rooms: RoomManager;
  readonly metrics: Metrics;
  listen(): Promise<number>;
  close(): Promise<void>;
}

type ClientState = 'hello' | 'lobby' | 'room' | 'closing';

function count(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** Content-Security-Policy for the single-file client: only its own inline scripts, by hash. */
function contentSecurityPolicy(html: string, origins: string[]): string {
  const hashes: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    if (m[1]) hashes.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  const sockets = origins.map((o) => o.replace(/^http/, 'ws'));
  return [
    "default-src 'none'",
    `script-src ${hashes.join(' ') || "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${sockets.join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function createGameServer(config: Config, now: () => number = Date.now): GameServer {
  const log = (ev: string, fields: Record<string, unknown> = {}) => {
    if (config.log) console.log(JSON.stringify({ ts: new Date().toISOString(), ev, ...fields }));
  };
  const metrics: Metrics = { messagesIn: 0, messagesOut: 0, bytesIn: 0, refused: {}, closed: {}, maxTickMs: 0 };

  let indexHtml: Buffer | null = null;
  let csp = "default-src 'none'";
  try {
    indexHtml = readFileSync(join(config.distDir, 'index.html'));
    csp = contentSecurityPolicy(indexHtml.toString('utf8'), config.allowedOrigins);
  } catch {
    log('client_missing', { hint: 'run npm run build' });
  }

  const rooms = new RoomManager(
    config.maxRooms,
    config,
    Math.random,
    (max) => cryptoRandomInt(max),
  );
  rooms.onEvent = log;

  const limiter = new ConnectionLimiter(config.maxConnections, config.maxConnectionsPerIp);
  const clients = new Set<Client>();
  let pending = 0;

  class Client implements Player {
    state: ClientState = 'hello';
    alive = true;
    wrongCodes = 0;
    private readonly ws: WebSocket;
    private readonly inputs: TokenBucket;
    private readonly others: TokenBucket;
    private readonly handshakeTimer: NodeJS.Timeout;

    constructor(ws: WebSocket) {
      this.ws = ws;
      const t = now();
      this.inputs = new TokenBucket(INPUT_BURST, INPUT_RATE, t);
      this.others = new TokenBucket(OTHER_BURST, OTHER_RATE, t);
      pending++;
      this.handshakeTimer = setTimeout(() => {
        if (this.state === 'hello') {
          this.send({ t: 'reject', reason: 'timeout' });
          this.fail(1008, 'handshake_timeout');
        }
      }, config.handshakeTimeoutMs);
    }

    send(msg: ServerMessage): void {
      if (this.ws.readyState !== this.ws.OPEN) return;
      metrics.messagesOut++;
      this.ws.send(JSON.stringify(msg));
    }

    end(): void {
      this.leaveHandshake();
      if (this.state === 'closing') return;
      this.state = 'closing';
      count(metrics.closed, 'normal');
      this.ws.close(1000);
    }

    fail(code: number, why: string): void {
      this.leaveHandshake();
      if (this.state === 'closing') return;
      this.state = 'closing';
      count(metrics.closed, why);
      rooms.leave(this);
      this.ws.close(code, why);
    }

    private leaveHandshake(): void {
      clearTimeout(this.handshakeTimer);
      if (this.state === 'hello') pending--;
    }

    onMessage(data: RawData, isBinary: boolean): void {
      if (this.state === 'closing') return;
      if (isBinary) return this.fail(1003, 'binary');
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      metrics.messagesIn++;
      metrics.bytesIn += text.length;
      const msg = parseClientMessage(text);
      if (!msg) return this.fail(1008, 'schema');
      const bucket = msg.t === 'in' ? this.inputs : this.others;
      if (!bucket.take(now())) return this.fail(1008, 'rate');

      switch (this.state) {
        case 'hello':
          if (msg.t !== 'hello') return this.fail(1008, 'protocol');
          if (msg.v !== PROTOCOL_VERSION) {
            this.send({ t: 'reject', reason: 'version' });
            return this.end();
          }
          this.leaveHandshake();
          this.state = 'lobby';
          this.send({ t: 'welcome', v: PROTOCOL_VERSION, hz: TICK_RATE });
          return;

        case 'lobby':
          if (msg.t === 'create') {
            const r = rooms.create(this, now(), msg.map);
            if (r.ok) this.state = 'room';
            else this.send({ t: 'reject', reason: r.reason });
            return;
          }
          if (msg.t === 'join') {
            const r = rooms.join(this, msg.code, now());
            if (r.ok) {
              this.state = 'room';
              return;
            }
            this.send({ t: 'reject', reason: r.reason });
            if (r.reason === 'bad_code' && ++this.wrongCodes >= config.maxWrongCodes) this.fail(1008, 'wrong_codes');
            return;
          }
          if (msg.t === 'leave') return this.end();
          return this.fail(1008, 'protocol');

        case 'room':
          if (msg.t === 'in') {
            const found = rooms.roomOf(this);
            if (!found?.room.match) return; // not started yet or already over: ignore
            if (!rooms.input(this, msg.s, msg.k)) this.fail(1008, 'sequence');
            return;
          }
          if (msg.t === 'rematch') {
            rooms.requestRematch(this, now());
            return;
          }
          if (msg.t === 'leave') {
            rooms.leave(this);
            return this.end();
          }
          return this.fail(1008, 'protocol');
      }
    }

    onClose(): void {
      this.leaveHandshake();
      this.state = 'closing';
      rooms.leave(this);
      clients.delete(this);
    }

    ping(): void {
      if (!this.alive) {
        count(metrics.closed, 'heartbeat');
        this.ws.terminate();
        return;
      }
      this.alive = false;
      this.ws.ping();
    }
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });

  function clientIp(req: IncomingMessage): string | null {
    if (!config.clientIpHeader) return req.socket.remoteAddress ?? null;
    const value = req.headers[config.clientIpHeader];
    const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim();
    return first && first.length <= 64 ? first : null;
  }

  function sendHeaders(res: ServerResponse, status: number, type: string, extra: Record<string, string> = {}): void {
    res.writeHead(status, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      ...extra,
    });
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendHeaders(res, 405, 'text/plain; charset=utf-8', { Allow: 'GET, HEAD' });
      return res.end('Method not allowed\n');
    }
    if (path === '/' || path === '/index.html') {
      if (!indexHtml) {
        sendHeaders(res, 503, 'text/plain; charset=utf-8');
        return res.end('Client not built: run npm run build\n');
      }
      sendHeaders(res, 200, 'text/html; charset=utf-8', { 'Content-Security-Policy': csp, 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : indexHtml);
    }
    if (path === '/status') {
      const body: StatusResponse = { state: rooms.busy ? 'busy' : 'free', protocol: PROTOCOL_VERSION };
      sendHeaders(res, 200, 'application/json', { 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    }
    sendHeaders(res, 404, 'text/plain; charset=utf-8');
    res.end('Not found\n');
  });

  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: number, why: string) => {
      count(metrics.refused, why);
      socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (req.url !== '/ws') return refuse(404, 'path');
    if (!config.allowedOrigins.includes(req.headers.origin ?? '')) return refuse(403, 'origin');
    const ip = clientIp(req);
    if (!ip) return refuse(400, 'no_client_ip');
    if (pending >= config.maxPendingHandshakes) return refuse(503, 'pending');
    const admitted = limiter.admit(ip);
    if (admitted !== 'ok') return refuse(503, admitted);

    let released = false;
    socket.once('close', () => {
      if (!released) {
        released = true;
        limiter.release(ip);
      }
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = new Client(ws);
      clients.add(client);
      ws.on('message', (data, isBinary) => client.onMessage(data, isBinary));
      ws.on('pong', () => (client.alive = true));
      ws.on('close', () => client.onClose());
      ws.on('error', () => {
        count(metrics.closed, 'error');
        ws.terminate();
      });
    });
  });

  // 30 Hz tick, catching up after short stalls.
  let tickTimer: NodeJS.Timeout | null = null;
  let nextTick = 0;
  const loop = () => {
    const t = now();
    if (t - nextTick > TICK_MS * 5) nextTick = t;
    while (t >= nextTick) {
      const started = performance.now();
      rooms.tick(t);
      metrics.maxTickMs = Math.max(metrics.maxTickMs, performance.now() - started);
      nextTick += TICK_MS;
    }
    tickTimer = setTimeout(loop, Math.max(1, nextTick - now()));
  };

  const heartbeat = setInterval(() => {
    for (const c of clients) c.ping();
  }, config.heartbeatIntervalMs);
  const metricsTimer = setInterval(() => {
    log('metrics', { sockets: limiter.open, rooms: rooms.roomCount, ...metrics });
    metrics.maxTickMs = 0;
  }, METRICS_INTERVAL_MS);
  heartbeat.unref();
  metricsTimer.unref();

  return {
    server,
    rooms,
    metrics,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          nextTick = now();
          loop();
          const port = (server.address() as AddressInfo).port;
          log('listening', { host: config.host, port, maxRooms: config.maxRooms });
          resolve(port);
        });
      });
    },
    close() {
      if (tickTimer) clearTimeout(tickTimer);
      clearInterval(heartbeat);
      clearInterval(metricsTimer);
      rooms.shutdown();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
