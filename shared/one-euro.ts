// One Euro filter (Casiez et al., 2012): an adaptive low-pass filter. Slow motion is smoothed strongly (kills
// jitter); fast motion is smoothed little (little lag). Used for the camera, which is the remote player.

export interface OneEuroOptions {
  /** Cutoff at rest (Hz): lower = smoother when still. */
  minCutoff: number;
  /** How fast the cutoff rises with speed. */
  beta: number;
  /** Cutoff for the speed estimate (Hz). */
  dCutoff: number;
}

/** Camera yaw (radians): strong smoothing when the opponent barely turns, about 3 degrees of lag at full turn speed. */
export const CAMERA_YAW_FILTER: OneEuroOptions = { minCutoff: 1.0, beta: 3.0, dCutoff: 1.0 };
/** Camera position (metres): the same idea for walking at up to 6 m/s. */
export const CAMERA_POSITION_FILTER: OneEuroOptions = { minCutoff: 1.0, beta: 1.5, dCutoff: 1.0 };

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private readonly o: OneEuroOptions;

  constructor(options: OneEuroOptions) {
    this.o = options;
  }

  reset(value?: number): void {
    this.x = value ?? null;
    this.dx = 0;
  }

  filter(value: number, dt: number): number {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.o.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.o.minCutoff + this.o.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** Filters an angle: works on the unwrapped angle so a turn across +-PI is not a jump. */
export class AngleFilter {
  private readonly inner: OneEuroFilter;
  private unwrapped: number | null = null;

  constructor(options: OneEuroOptions) {
    this.inner = new OneEuroFilter(options);
  }

  reset(value?: number): void {
    this.unwrapped = value ?? null;
    this.inner.reset(value);
  }

  filter(angle: number, dt: number): number {
    if (this.unwrapped === null) {
      this.unwrapped = angle;
    } else {
      let d = angle - this.unwrapped;
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      this.unwrapped += d;
    }
    return this.inner.filter(this.unwrapped, dt);
  }
}
