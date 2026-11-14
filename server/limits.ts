// Rate and connection limits.

/** Token bucket: `capacity` tokens, refilled at `ratePerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly ratePerSec: number;

  constructor(capacity: number, ratePerSec: number, nowMs: number) {
    this.capacity = capacity;
    this.ratePerSec = ratePerSec;
    this.tokens = capacity;
    this.last = nowMs;
  }

  take(nowMs: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((nowMs - this.last) / 1000) * this.ratePerSec);
    this.last = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export type AdmitResult = 'ok' | 'too_many' | 'too_many_from_ip';

/** Counts open sockets in total and per client IP. */
export class ConnectionLimiter {
  private total = 0;
  private readonly perIp = new Map<string, number>();
  private readonly maxTotal: number;
  private readonly maxPerIp: number;

  constructor(maxTotal: number, maxPerIp: number) {
    this.maxTotal = maxTotal;
    this.maxPerIp = maxPerIp;
  }

  admit(ip: string): AdmitResult {
    if (this.total >= this.maxTotal) return 'too_many';
    const n = this.perIp.get(ip) ?? 0;
    if (n >= this.maxPerIp) return 'too_many_from_ip';
    this.total++;
    this.perIp.set(ip, n + 1);
    return 'ok';
  }

  release(ip: string): void {
    const n = this.perIp.get(ip) ?? 0;
    if (n <= 0) return;
    this.total--;
    if (n === 1) this.perIp.delete(ip);
    else this.perIp.set(ip, n - 1);
  }

  get open(): number {
    return this.total;
  }
}
