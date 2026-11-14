// npm run sim -- [--seconds N] [--seed N]: a headless bot-vs-bot match on the shared simulation.
import { parseArgs } from 'node:util';
import { runMatch } from '../shared/sim.ts';

const { values } = parseArgs({
  options: {
    seconds: { type: 'string', default: '300' },
    seed: { type: 'string', default: '1' },
  },
});

const seconds = Number(values.seconds);
const seed = Number(values.seed);
if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(seed)) {
  console.error('Usage: npm run sim -- [--seconds N] [--seed N]');
  process.exit(2);
}

const started = performance.now();
const r = runMatch({ seconds, seed });
const ms = performance.now() - started;

console.log(`Simulated ${r.seconds} s (${r.steps} steps, seed ${seed}) in ${ms.toFixed(0)} ms`);
console.log(`Bot A: ${r.hits[0]} hits / ${r.shots[0]} shots`);
console.log(`Bot B: ${r.hits[1]} hits / ${r.shots[1]} shots`);
console.log(`Invalid positions: ${r.invalidPositions}`);
if (r.invalidPositions > 0) process.exit(1);
