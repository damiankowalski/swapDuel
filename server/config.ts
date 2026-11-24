// Server configuration from environment variables (docs/NETWORKING.md §2, docs/DEPLOYMENT.md §4).

export interface Config {
  host: string;
  port: number;
  /** Exact origins allowed to open a WebSocket. */
  allowedOrigins: string[];
  /** Header with the client IP set by a trusted front door (lower case), or null to use the socket address. */
  clientIpHeader: string | null;
  maxRooms: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxPendingHandshakes: number;
  maxWrongCodes: number;
  handshakeTimeoutMs: number;
  waitingRoomTimeoutMs: number;
  idleTimeoutMs: number;
  heartbeatIntervalMs: number;
  matchMaxMs: number;
  rematchTimeoutMs: number;
  /** Countdown before a match (s); unset = the game's COUNTDOWN. Tests set 0. */
  countdownSeconds?: number;
  /** Folder with the built client (index.html). */
  distDir: string;
  /** Write log lines to stdout. */
  log: boolean;
}

export const DEFAULTS: Omit<Config, 'allowedOrigins' | 'distDir'> = {
  host: '127.0.0.1',
  port: 8080,
  clientIpHeader: null,
  maxRooms: 1,
  maxConnections: 16,
  maxConnectionsPerIp: 4,
  maxPendingHandshakes: 8,
  maxWrongCodes: 5,
  handshakeTimeoutMs: 5_000,
  waitingRoomTimeoutMs: 180_000,
  idleTimeoutMs: 60_000,
  heartbeatIntervalMs: 5_000,
  matchMaxMs: 20 * 60_000,
  rematchTimeoutMs: 60_000,
  log: true,
};

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

function seconds(env: NodeJS.ProcessEnv, name: string, fallbackMs: number, min: number, max: number): number {
  return int(env, name, fallbackMs / 1000, min, max) * 1000;
}

function parseOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== value) {
    throw new Error(`ALLOWED_ORIGINS: "${value}" is not an exact http(s) origin like https://example.com`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv, distDir: string): Config {
  const host = env['HOST'] || DEFAULTS.host;
  const port = int(env, 'PORT', DEFAULTS.port, 1, 65535);
  const origins = (env['ALLOWED_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origins.length === 0 && !LOOPBACK.has(host)) {
    throw new Error('ALLOWED_ORIGINS must be set when HOST is not a loopback address');
  }
  const allowedOrigins = origins.length > 0
    ? origins.map(parseOrigin)
    : [`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
  const header = (env['CLIENT_IP_HEADER'] ?? '').trim().toLowerCase();
  if (header && !/^[a-z0-9-]{1,64}$/.test(header)) throw new Error('CLIENT_IP_HEADER must be a header name');

  return {
    host,
    port,
    allowedOrigins,
    clientIpHeader: header || null,
    maxRooms: int(env, 'MAX_ROOMS', DEFAULTS.maxRooms, 1, 100),
    maxConnections: int(env, 'MAX_CONNECTIONS', DEFAULTS.maxConnections, 2, 10_000),
    maxConnectionsPerIp: int(env, 'MAX_CONNECTIONS_PER_IP', DEFAULTS.maxConnectionsPerIp, 1, 1000),
    maxPendingHandshakes: int(env, 'MAX_PENDING_HANDSHAKES', DEFAULTS.maxPendingHandshakes, 1, 1000),
    maxWrongCodes: DEFAULTS.maxWrongCodes,
    handshakeTimeoutMs: seconds(env, 'HANDSHAKE_TIMEOUT_S', DEFAULTS.handshakeTimeoutMs, 1, 60),
    waitingRoomTimeoutMs: seconds(env, 'WAITING_ROOM_TIMEOUT_S', DEFAULTS.waitingRoomTimeoutMs, 10, 3600),
    idleTimeoutMs: seconds(env, 'IDLE_TIMEOUT_S', DEFAULTS.idleTimeoutMs, 10, 3600),
    heartbeatIntervalMs: seconds(env, 'HEARTBEAT_INTERVAL_S', DEFAULTS.heartbeatIntervalMs, 1, 60),
    matchMaxMs: seconds(env, 'MATCH_MAX_S', DEFAULTS.matchMaxMs, 60, 24 * 3600),
    rematchTimeoutMs: seconds(env, 'REMATCH_TIMEOUT_S', DEFAULTS.rematchTimeoutMs, 10, 3600),
    distDir,
    log: true,
  };
}
