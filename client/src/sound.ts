// Game sounds synthesised with Web Audio: no audio files, nothing to download or license. The AudioContext starts on
// the first click or key press (browsers block sound before a user gesture); M mutes, and the choice is remembered.
import { distanceGain } from './anim.ts';

const MUTE_KEY = 'swapduel.muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = readMuted();

  /** Call from a user gesture: creates or resumes the audio context. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.6);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // private mode: the choice lasts until reload
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  private ready(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx || !this.master || this.muted || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, out: this.master };
  }

  /** A burst of filtered noise: whooshes, splats and thuds. */
  private noiseHit(opts: { dur: number; gain: number; type: BiquadFilterType; from: number; to: number; q?: number; delay?: number }): void {
    const r = this.ready();
    if (!r || !this.noise) return;
    const { ctx, out } = r;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q ?? 1;
    filter.frequency.setValueAtTime(opts.from, t0);
    filter.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + Math.min(0.02, opts.dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t0, Math.random() * 0.2, opts.dur + 0.05);
  }

  /** A short tone with a pitch glide. */
  private tone(opts: { freq: number; to?: number; dur: number; gain: number; type?: OscillatorType; delay?: number }): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'triangle';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  /** A snowball leaves a hand; `mine` is louder than the opponent's. */
  throw(mine: boolean): void {
    this.noiseHit({ dur: 0.22, gain: mine ? 0.35 : 0.15, type: 'bandpass', from: 700, to: 2600, q: 1.4 });
  }

  /** A snowball splats `distance` metres from the camera. */
  splat(distance: number): void {
    const v = distanceGain(distance);
    this.noiseHit({ dur: 0.18, gain: 0.5 * v, type: 'lowpass', from: 2200, to: 300 });
    this.noiseHit({ dur: 0.08, gain: 0.25 * v, type: 'highpass', from: 3000, to: 1500 });
  }

  /** Your snowball hit the opponent: a bright two-note ding. */
  scored(): void {
    this.tone({ freq: 880, dur: 0.12, gain: 0.25 });
    this.tone({ freq: 1320, dur: 0.22, gain: 0.25, delay: 0.08 });
  }

  /** You were hit: a dull thud. */
  hurt(): void {
    this.tone({ freq: 160, to: 60, dur: 0.25, gain: 0.5, type: 'sine' });
    this.noiseHit({ dur: 0.2, gain: 0.4, type: 'lowpass', from: 900, to: 150 });
  }

  /** Someone slid into the ditch: a falling whistle. */
  fall(): void {
    this.tone({ freq: 900, to: 180, dur: 0.6, gain: 0.18, type: 'sine' });
  }

  /** Countdown beep; `go` is the higher final one. */
  beep(go: boolean): void {
    this.tone({ freq: go ? 1046 : 523, dur: go ? 0.35 : 0.15, gain: 0.22, type: 'square' });
  }

  /** End of the match. */
  over(won: boolean): void {
    const notes = won ? [523, 659, 784, 1046] : [392, 330, 262];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.3, gain: 0.22, delay: i * 0.13 }));
  }
}
