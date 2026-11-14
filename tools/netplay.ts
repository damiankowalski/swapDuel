// Headless network match for the CAMERA requirement (docs/NETWORKING.md §12): the real server match logic, snapshots
// delivered through the lag simulator, and the client's interpolation + camera filter rendering at 60 fps.
// The opponent (seat 1) follows a random input script; we measure how smoothly seat 0's camera - the opponent's eyes -
// moves, compared with the opponent's real motion.
import { TURN_SPEED, MOVE_SPEED } from '../shared/constants.ts';
import { SnapshotInterpolator } from '../shared/interpolation.ts';
import { LagSimulator, type LagOptions } from '../shared/lag.ts';
import { wrapAngle } from '../shared/math.ts';
import { AngleFilter, CAMERA_POSITION_FILTER, CAMERA_YAW_FILTER, OneEuroFilter } from '../shared/one-euro.ts';
import {
  KEY_BACK,
  KEY_FORWARD,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_TURN_LEFT,
  KEY_TURN_RIGHT,
  TICK_DT,
  type Pose,
} from '../shared/protocol.ts';
import { seededRng } from '../shared/rng.ts';
import { Match } from '../server/match.ts';

export interface NetplayOptions {
  seconds: number;
  seed: number;
  lag: LagOptions;
  fps?: number;
}

export interface CameraMetrics {
  /** RMS of the frame-to-frame change of yaw step (deg/frame^2): high = shaky. */
  yawJerkRms: number;
  /** Largest yaw step in one frame beyond what a fighter can really turn in a frame (deg). */
  maxYawStepExcess: number;
  /** Largest position step in one frame beyond what a fighter can really walk in a frame (m). */
  maxPosStepExcess: number;
}

export interface NetplayResult {
  frames: number;
  /** The opponent's real motion, sampled at the same 60 fps. */
  truth: CameraMetrics;
  /** Camera with buffered interpolation and the One Euro filter (P2). */
  camera: CameraMetrics;
  /** Camera as in v0.1.0: chasing the newest packet with exponential smoothing. */
  naive: CameraMetrics;
  /** camera.yawJerkRms / truth.yawJerkRms */
  jitterRatio: number;
  starvations: number;
  finalDelayMs: number;
}

const DEG = 180 / Math.PI;
const SCRIPT: number[] = [
  0,
  KEY_FORWARD,
  KEY_TURN_LEFT,
  KEY_TURN_RIGHT,
  KEY_FORWARD | KEY_TURN_LEFT,
  KEY_FORWARD | KEY_TURN_RIGHT,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_BACK | KEY_TURN_LEFT,
];

class Track {
  private poses: Pose[] = [];
  push(p: Pose): void {
    this.poses.push({ ...p });
  }
  metrics(frameDt: number): CameraMetrics {
    const maxTurn = TURN_SPEED * frameDt * DEG;
    const maxWalk = MOVE_SPEED * frameDt;
    let jerkSq = 0;
    let n = 0;
    let yawExcess = 0;
    let posExcess = 0;
    for (let i = 1; i < this.poses.length; i++) {
      const a = this.poses[i - 1]!;
      const b = this.poses[i]!;
      const step = wrapAngle(b.yaw - a.yaw) * DEG;
      yawExcess = Math.max(yawExcess, Math.abs(step) - maxTurn);
      posExcess = Math.max(posExcess, Math.hypot(b.x - a.x, b.z - a.z) - maxWalk);
      if (i >= 2) {
        const prev = wrapAngle(a.yaw - this.poses[i - 2]!.yaw) * DEG;
        jerkSq += (step - prev) ** 2;
        n++;
      }
    }
    return {
      yawJerkRms: n ? Math.sqrt(jerkSq / n) : 0,
      maxYawStepExcess: Math.max(0, yawExcess),
      maxPosStepExcess: Math.max(0, posExcess),
    };
  }
}

export function runNetplay(options: NetplayOptions): NetplayResult {
  const fps = options.fps ?? 60;
  const frameDt = 1 / fps;
  const rng = seededRng(options.seed);
  const match = new Match(rng);
  const lag = new LagSimulator(options.lag, seededRng(options.seed + 1));

  const interp = new SnapshotInterpolator();
  const yawFilter = new AngleFilter(CAMERA_YAW_FILTER);
  const xFilter = new OneEuroFilter(CAMERA_POSITION_FILTER);
  const zFilter = new OneEuroFilter(CAMERA_POSITION_FILTER);
  const naive: Pose = match.pose(1);
  let newest: Pose = match.pose(1);

  const truth = new Track();
  const camera = new Track();
  const naiveTrack = new Track();
  const inFlight: Array<{ at: number; tick: number; pose: Pose }> = [];
  const serverStates: Pose[] = [match.pose(1)];

  let keys = 0;
  let nextChange = 0;
  let seq = 0;
  const ticks = Math.round(options.seconds / TICK_DT);
  const frames = Math.floor(options.seconds * fps);
  let tick = 0;

  for (let f = 0; f < frames; f++) {
    const t = f * frameDt + 0.005; // seconds; frames are not aligned with ticks
    // Server ticks up to this frame.
    while (tick < ticks && (tick + 1) * TICK_DT <= t) {
      tick++;
      if (tick * TICK_DT >= nextChange) {
        keys = SCRIPT[Math.floor(rng() * SCRIPT.length)]!;
        nextChange = tick * TICK_DT + 0.5 + rng() * 1.5;
      }
      match.pushInput(1, seq++, keys);
      match.step();
      const snap = match.snapshot(0);
      serverStates.push(snap.opp);
      inFlight.push({ at: lag.deliveryTime(tick * TICK_DT * 1000) / 1000, tick, pose: snap.opp });
    }
    // Deliver what has arrived.
    while (inFlight.length > 0 && inFlight[0]!.at <= t) {
      const m = inFlight.shift()!;
      interp.push(m.tick, m.pose, false, m.at);
      newest = m.pose;
    }
    // P2 camera.
    const s = interp.sample(t);
    if (s) {
      if (s.cut) {
        yawFilter.reset();
        xFilter.reset();
        zFilter.reset();
      }
      camera.push({ x: xFilter.filter(s.pose.x, frameDt), z: zFilter.filter(s.pose.z, frameDt), yaw: yawFilter.filter(s.pose.yaw, frameDt) });
    }
    // v0.1.0 camera.
    const k = Math.min(1, frameDt * 12);
    naive.x += (newest.x - naive.x) * k;
    naive.z += (newest.z - naive.z) * k;
    naive.yaw += wrapAngle(newest.yaw - naive.yaw) * k;
    naiveTrack.push(naive);
    // Truth: the server's real path, interpolated between ticks (a constant delay does not change the metrics).
    const exact = Math.max(0, t / TICK_DT - 1); // one tick behind, so both neighbours exist
    const i = Math.min(Math.floor(exact), serverStates.length - 2);
    const a = serverStates[Math.max(0, i)]!;
    const b = serverStates[Math.max(0, i) + 1] ?? a;
    const u = Math.max(0, Math.min(1, exact - i));
    truth.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + wrapAngle(b.yaw - a.yaw) * u });
  }

  const truthM = truth.metrics(frameDt);
  const cameraM = camera.metrics(frameDt);
  return {
    frames,
    truth: truthM,
    camera: cameraM,
    naive: naiveTrack.metrics(frameDt),
    jitterRatio: truthM.yawJerkRms > 0 ? cameraM.yawJerkRms / truthM.yawJerkRms : 0,
    starvations: interp.starvations,
    finalDelayMs: interp.delay * 1000,
  };
}
