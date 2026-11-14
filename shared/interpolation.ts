// Interpolation of the remote fighter from buffered snapshots (docs/NETWORKING.md §8).
// The opponent is drawn `delay` behind the fastest recent arrivals; the delay adapts slowly to the spread of
// arrival times (jitter), so late snapshots still arrive before they are needed.
import { wrapAngle } from './math.ts';
import { TICK_DT, type Pose } from './protocol.ts';

export const MIN_DELAY = 0.1; // s
export const MAX_EXTRAPOLATION = 0.1; // s
/** Largest speed at which the delay may change (fraction of real time): the opponent's motion is played at most
 * 10% slower while the delay grows and 2% faster while it shrinks, which is not noticeable. */
const DELAY_GROW_SLEW = 0.1;
const DELAY_SHRINK_SLEW = 0.02;
const OFFSET_SMOOTHING = 0.05;
const SPREAD_SMOOTHING = 0.05;
/** Arrival samples kept (3 s at 30 Hz). */
const WINDOW = 90;
/** 1 = the latest arrival in the window; lower values trade a few starvations for less delay. */
const LATE_PERCENTILE = 1;
const SAFETY_MARGIN = 0.01; // s
const MAX_BUFFER = 64;

interface Entry {
  tick: number;
  pose: Pose;
  /** The fighter teleported at this tick (respawn): no interpolation into it. */
  cut: boolean;
}

export interface Sample {
  pose: Pose;
  /** A teleport was passed since the previous sample: reset any smoothing. */
  cut: boolean;
  extrapolating: boolean;
  /** Server tick being shown (fractional): events such as snowball throws are drawn on the same clock. */
  renderTick: number;
}

export class SnapshotInterpolator {
  private buffer: Entry[] = [];
  /** Arrival time minus server time of the fastest recent snapshots (s), smoothed. */
  private offset: number | null = null;
  /** Recent arrival-minus-server-time samples, for the jitter spread. */
  private samples: number[] = [];
  private spread = 0;
  delay = MIN_DELAY;
  starvations = 0;
  private starving = false;
  private lastRenderTick = -Infinity;
  private lastSampleTime: number | null = null;

  push(tick: number, pose: Pose, cut: boolean, arrivalSec: number): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && tick <= last.tick) return; // stale or duplicate
    this.buffer.push({ tick, pose, cut });
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();

    // How late did this snapshot arrive, compared with the fastest one of the last few seconds?
    const sample = arrivalSec - tick * TICK_DT;
    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    const fastest = sorted[0]!;
    const late = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * LATE_PERCENTILE))]!;
    if (this.offset === null) this.offset = fastest;
    else this.offset += OFFSET_SMOOTHING * (fastest - this.offset);
    this.spread += SPREAD_SMOOTHING * (late - fastest - this.spread);
  }

  /** Delay that covers the spread of recent arrival times, plus one tick. */
  get targetDelay(): number {
    return Math.max(MIN_DELAY, TICK_DT + this.spread + SAFETY_MARGIN);
  }

  /** Spread between the fastest and the latest recent arrivals (s). */
  get jitterEstimate(): number {
    return this.spread;
  }

  get bufferedTicks(): number {
    return this.buffer.length;
  }

  sample(nowSec: number): Sample | null {
    if (this.offset === null || this.buffer.length === 0) return null;
    const frameDt = this.lastSampleTime === null ? 0 : Math.max(0, nowSec - this.lastSampleTime);
    this.lastSampleTime = nowSec;
    this.delay += Math.max(-DELAY_SHRINK_SLEW * frameDt, Math.min(DELAY_GROW_SLEW * frameDt, this.targetDelay - this.delay));

    let renderTick = (nowSec - this.offset - this.delay) / TICK_DT;
    // Starved for longer than we may extrapolate: pause the opponent's clock instead of jumping later. The extra
    // delay is played back slowly afterwards (it shrinks at DELAY_SHRINK_SLEW).
    const newest = this.buffer[this.buffer.length - 1]!;
    const limit = newest.tick + MAX_EXTRAPOLATION / TICK_DT;
    if (renderTick > limit) {
      this.delay += (renderTick - limit) * TICK_DT;
      renderTick = limit;
    }
    let cut = false;
    for (const e of this.buffer) if (e.cut && e.tick > this.lastRenderTick && e.tick <= renderTick) cut = true;
    this.lastRenderTick = Math.max(this.lastRenderTick, renderTick);

    const first = this.buffer[0]!;
    const last = this.buffer[this.buffer.length - 1]!;
    if (renderTick <= first.tick) return { pose: { ...first.pose }, cut, renderTick, extrapolating: false };

    if (renderTick >= last.tick) {
      if (!this.starving && renderTick > last.tick) {
        this.starving = true;
        this.starvations++;
      }
      const before = this.buffer[this.buffer.length - 2];
      const over = Math.min(renderTick - last.tick, MAX_EXTRAPOLATION / TICK_DT);
      if (!before || last.cut || last.tick - before.tick !== 1) return { pose: { ...last.pose }, cut, renderTick, extrapolating: true };
      return {
        pose: {
          x: last.pose.x + (last.pose.x - before.pose.x) * over,
          z: last.pose.z + (last.pose.z - before.pose.z) * over,
          yaw: wrapAngle(last.pose.yaw + wrapAngle(last.pose.yaw - before.pose.yaw) * over),
        },
        cut,
        renderTick,
        extrapolating: true,
      };
    }
    this.starving = false;

    let i = 0;
    while (this.buffer[i + 1]!.tick <= renderTick) i++;
    const a = this.buffer[i]!;
    const b = this.buffer[i + 1]!;
    // Drop what can no longer be needed.
    if (i > 2) this.buffer.splice(0, i - 2);
    if (b.cut) return { pose: { ...a.pose }, cut, renderTick, extrapolating: false };
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    return {
      pose: {
        x: a.pose.x + (b.pose.x - a.pose.x) * t,
        z: a.pose.z + (b.pose.z - a.pose.z) * t,
        yaw: wrapAngle(a.pose.yaw + wrapAngle(b.pose.yaw - a.pose.yaw) * t),
      },
      cut,
      renderTick,
      extrapolating: false,
    };
  }
}
