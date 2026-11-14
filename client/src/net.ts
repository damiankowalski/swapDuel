// Online session with the game server: WebSocket, handshake, rooms, prediction of the local fighter and
// interpolation of the opponent (docs/NETWORKING.md). No rendering here.
import { SnapshotInterpolator } from '../../shared/interpolation.ts';
import { LagSimulator, type LagOptions } from '../../shared/lag.ts';
import { Predictor } from '../../shared/prediction.ts';
import { createThrower, pressFire, tickThrower } from '../../shared/snowball.ts';
import {
  KEY_FIRE,
  parseServerMessage,
  parseStatus,
  PROTOCOL_VERSION,
  type ClientMessage,
  type EndReason,
  type GameEvent,
  type Pose,
  type RejectReason,
  type ServerMessage,
  type StatusResponse,
} from '../../shared/protocol.ts';

export interface SessionHandlers {
  onRoom(code: string, seat: 0 | 1): void;
  onStart(you: Pose, opp: Pose): void;
  onSnapshot(tick: number, score: [number, number], events: GameEvent[]): void;
  onReject(reason: RejectReason): void;
  onEnd(reason: EndReason): void;
  onClosed(): void;
}

export interface NetStats {
  rttMs: number;
  delayMs: number;
  jitterMs: number;
  starvations: number;
  corrections: number;
  lastCorrection: number;
}

/** GET /status; null when there is no game server (opened from a file, or on static hosting). */
export async function fetchStatus(): Promise<StatusResponse | null> {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return null;
  try {
    const res = await fetch('/status', { cache: 'no-store' });
    if (!res.ok) return null;
    return parseStatus(await res.json());
  } catch {
    return null;
  }
}

const nowSec = () => performance.now() / 1000;

/** Runs callbacks at given times, strictly in the order they were added (setTimeout alone can reorder them,
 * because browsers round delays to whole milliseconds). Used only by the lag simulator. */
class DelayQueue {
  private readonly items: Array<{ at: number; run: () => void }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly lag: LagSimulator;

  constructor(lag: LagSimulator) {
    this.lag = lag;
  }

  push(run: () => void): void {
    this.items.push({ at: this.lag.deliveryTime(performance.now()), run });
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null || this.items.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = performance.now();
      while (this.items.length > 0 && this.items[0]!.at <= now) this.items.shift()!.run();
      this.schedule();
    }, Math.max(0, this.items[0]!.at - performance.now()));
  }
}

export class OnlineSession {
  predictor: Predictor | null = null;
  readonly interp = new SnapshotInterpolator();
  private ws: WebSocket | null = null;
  private readonly handlers: SessionHandlers;
  private readonly outLag: DelayQueue | null;
  private readonly inLag: DelayQueue | null;
  private readonly sentAt = new Map<number, number>();
  private rtt = 0;
  private finished = false;
  /** Local copy of the throwing rules, so our own snowballs leave the hand at once. The server's stock is the truth. */
  private readonly thrower = createThrower();
  /** Inputs not yet acknowledged that threw a snowball. */
  private readonly pendingThrows = new Set<number>();
  /** Snowballs and seconds to the next one, from the latest snapshot. */
  serverAmmo = 0;
  nextSnowball = 0;

  constructor(handlers: SessionHandlers, lag: LagOptions | null) {
    this.handlers = handlers;
    this.outLag = lag ? new DelayQueue(new LagSimulator(lag, Math.random)) : null;
    this.inLag = lag ? new DelayQueue(new LagSimulator(lag, Math.random)) : null;
  }

  /** Opens the socket and completes the handshake; resolves false if the server cannot be reached. */
  connect(): Promise<boolean> {
    return new Promise((resolve) => {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${location.host}/ws`);
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION });
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        const text = e.data;
        const deliver = () => {
          const msg = parseServerMessage(text);
          if (!msg) return;
          if (msg.t === 'welcome' && !welcomed) {
            welcomed = true;
            resolve(true);
            return;
          }
          this.handle(msg);
        };
        if (this.inLag) this.inLag.push(deliver);
        else deliver();
      };
      ws.onclose = () => {
        const closed = () => {
          if (!welcomed) resolve(false);
          else if (!this.finished) this.handlers.onClosed();
          this.finished = true;
        };
        // With simulated lag the close must not overtake messages still "in flight" (such as "end").
        if (this.inLag) this.inLag.push(closed);
        else closed();
      };
    });
  }

  create(): void {
    this.send({ t: 'create' });
  }

  join(code: string): void {
    this.send({ t: 'join', code });
  }

  /** One client tick: predict locally and send the input. Returns true when this tick throws a snowball. */
  tick(keys: number, dt: number): boolean {
    if (!this.predictor) return false;
    const input = this.predictor.step(keys);
    this.sentAt.set(input.s, performance.now());
    this.send({ t: 'in', s: input.s, k: input.k });
    tickThrower(this.thrower, dt);
    this.thrower.ammo = this.ammo;
    const threw = pressFire(this.thrower, (keys & KEY_FIRE) !== 0);
    if (threw) this.pendingThrows.add(input.s);
    return threw;
  }

  /** Snowballs we have, counting throws the server has not confirmed yet. */
  get ammo(): number {
    return Math.max(0, this.serverAmmo - this.pendingThrows.size);
  }

  leave(): void {
    this.finished = true;
    this.send({ t: 'leave' });
    this.ws?.close();
  }

  get stats(): NetStats {
    return {
      rttMs: this.rtt,
      delayMs: this.interp.delay * 1000,
      jitterMs: this.interp.jitterEstimate * 1000,
      starvations: this.interp.starvations,
      corrections: this.predictor?.corrections ?? 0,
      lastCorrection: this.predictor?.lastCorrection ?? 0,
    };
  }

  private send(msg: ClientMessage): void {
    const ws = this.ws;
    if (!ws) return;
    const text = JSON.stringify(msg);
    const go = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    };
    if (this.outLag) this.outLag.push(go);
    else go();
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'room':
        this.handlers.onRoom(msg.code, msg.seat);
        return;
      case 'start':
        this.predictor = new Predictor(msg.you);
        this.serverAmmo = this.thrower.ammo;
        this.interp.push(msg.tick, msg.opp, true, nowSec());
        this.handlers.onStart(msg.you, msg.opp);
        return;
      case 'snap': {
        if (!this.predictor) return;
        const sent = this.sentAt.get(msg.ack);
        if (sent !== undefined) {
          const sample = performance.now() - sent;
          this.rtt = this.rtt === 0 ? sample : this.rtt + 0.1 * (sample - this.rtt);
          for (const s of this.sentAt.keys()) if (s <= msg.ack) this.sentAt.delete(s);
        }
        this.predictor.reconcile(msg.ack, msg.you);
        for (const s of this.pendingThrows) if (s <= msg.ack) this.pendingThrows.delete(s);
        this.serverAmmo = msg.ammo;
        this.nextSnowball = msg.next;
        const oppTeleported = msg.ev.some((e) => e.k === 'spawn' && e.who === 'opp');
        this.interp.push(msg.tick, msg.opp, oppTeleported, nowSec());
        this.handlers.onSnapshot(msg.tick, msg.score, msg.ev);
        return;
      }
      case 'reject':
        this.handlers.onReject(msg.reason);
        return;
      case 'end':
        this.finished = true;
        this.handlers.onEnd(msg.reason);
        return;
      case 'welcome':
        return;
    }
  }
}
