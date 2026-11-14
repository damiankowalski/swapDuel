// npm run sim -- [--seconds N] [--seed N]                         headless bot-vs-bot match (game rules)
// npm run sim -- --net [--lag MS] [--jitter MS] [--stall P] ...   headless network match: camera smoothness
import { parseArgs } from 'node:util';
import { runMatch } from '../shared/sim.ts';
import { runNetplay } from './netplay.ts';

const { values } = parseArgs({
  options: {
    seconds: { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
    net: { type: 'boolean', default: false },
    lag: { type: 'string', default: '150' },
    jitter: { type: 'string', default: '30' },
    stall: { type: 'string', default: '0' },
  },
});

const seconds = Number(values.seconds);
const seed = Number(values.seed);
const delayMs = Number(values.lag);
const jitterMs = Number(values.jitter);
const stallChance = Number(values.stall);
const valid = [seconds, delayMs, jitterMs, stallChance].every((n) => Number.isFinite(n) && n >= 0);
if (!valid || seconds === 0 || !Number.isInteger(seed) || stallChance > 1) {
  console.error('Usage: npm run sim -- [--seconds N] [--seed N] [--net --lag MS --jitter MS --stall P]');
  process.exit(2);
}

const started = performance.now();
if (values.net) {
  const r = runNetplay({ seconds, seed, lag: { delayMs, jitterMs, stallChance } });
  const row = (name: string, m: typeof r.camera) =>
    `${name.padEnd(8)} yaw jerk ${m.yawJerkRms.toFixed(3)} deg/frame^2, max yaw jump ${m.maxYawStepExcess.toFixed(2)} deg, max position jump ${m.maxPosStepExcess.toFixed(3)} m`;
  console.log(`Network match: ${seconds} s, seed ${seed}, one-way ${delayMs} ms +- ${jitterMs} ms, stalls ${stallChance}`);
  console.log(row('truth', r.truth));
  console.log(row('camera', r.camera));
  console.log(row('v0.1.0', r.naive));
  console.log(`Jitter ratio camera/truth ${r.jitterRatio.toFixed(2)}, starvations ${r.starvations}, final delay ${r.finalDelayMs.toFixed(0)} ms`);
} else {
  const r = runMatch({ seconds, seed });
  console.log(`Simulated ${r.seconds} s (${r.steps} steps, seed ${seed})`);
  console.log(`Bot A: ${r.hits[0]} hits / ${r.throws[0]} snowballs`);
  console.log(`Bot B: ${r.hits[1]} hits / ${r.throws[1]} snowballs`);
  console.log(`Invalid states: ${r.invalid}, snowballs still flying: ${r.inFlight}`);
  if (r.invalid > 0) process.exitCode = 1;
}
console.log(`(${(performance.now() - started).toFixed(0)} ms)`);
