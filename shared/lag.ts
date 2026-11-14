// Network condition simulator: one-way delay, jitter and stalls over an ordered stream (TCP / WebSocket).
// Used by the dev client (?lag=150&jitter=30&stall=0.02) and by headless tests.
import type { Rng } from './rng.ts';

export interface LagOptions {
  /** One-way delay (ms). */
  delayMs: number;
  /** Standard deviation of extra delay (ms); never makes a message earlier than delayMs / 2. */
  jitterMs: number;
  /** Probability per message of a stall (TCP retransmission / head-of-line blocking). */
  stallChance: number;
  /** Length of a stall (ms). */
  stallMs?: number;
}

export const NO_LAG: LagOptions = { delayMs: 0, jitterMs: 0, stallChance: 0 };

/** Computes delivery times; messages are never reordered, as on a WebSocket. */
export class LagSimulator {
  private lastDelivery = -Infinity;
  private readonly options: LagOptions;
  private readonly rng: Rng;

  constructor(options: LagOptions, rng: Rng) {
    this.options = options;
    this.rng = rng;
  }

  get active(): boolean {
    return this.options.delayMs > 0 || this.options.jitterMs > 0 || this.options.stallChance > 0;
  }

  deliveryTime(sendTimeMs: number): number {
    const { delayMs, jitterMs, stallChance, stallMs = 200 } = this.options;
    let delay = delayMs + gaussian(this.rng) * jitterMs;
    delay = Math.max(delayMs / 2, delay);
    if (stallChance > 0 && this.rng() < stallChance) delay += stallMs;
    const at = Math.max(this.lastDelivery, sendTimeMs + delay);
    this.lastDelivery = at;
    return at;
  }
}

/** Standard normal sample (Box-Muller). */
export function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Builds options from ?lag=&jitter=&stall= values; null when none is set or a value is out of range. */
export function lagFromParams(get: (name: string) => string | null): LagOptions | null {
  const lag = get('lag');
  const jitter = get('jitter');
  const stall = get('stall');
  if (lag === null && jitter === null && stall === null) return null;
  const delayMs = Number(lag ?? 0);
  const jitterMs = Number(jitter ?? 0);
  const stallChance = Number(stall ?? 0);
  const ok = (n: number, max: number) => Number.isFinite(n) && n >= 0 && n <= max;
  return ok(delayMs, 2000) && ok(jitterMs, 1000) && ok(stallChance, 1) ? { delayMs, jitterMs, stallChance } : null;
}
