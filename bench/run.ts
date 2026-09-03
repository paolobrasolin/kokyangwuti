// Headless generation runner (Node, no DOM).
//
// One seed on this thread:
//   npm run headless -- --generations 20 --pop 8 --seed 7
//
// Several seeds at once, one complete independent run per worker thread:
//   npm run headless -- --generations 20 --seeds 1,2,3,4
//   npm run headless -- --generations 20 --seeds 8 --threads 4   # seed..seed+7
//
// Other options: --pop, --width, --height, --flyRate, --genomes (print each
// run's final winning genome). Every run is exactly what the page would
// compute for that seed; parallelism only decides how many run at a time.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { CONFIG } from '../src/config';
import {
  DT,
  type GenerationEvent,
  type RunOptions,
  type RunSummary,
  runSeed,
} from './headless';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return fallback;
  const value = Number(process.argv[i + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} wants a number`);
  return value;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** `--seeds a,b,c` is a list; `--seeds N` is N consecutive seeds from `--seed`. */
function seedList(base: number): number[] {
  const i = process.argv.indexOf('--seeds');
  if (i < 0 || i + 1 >= process.argv.length) return [base];
  const raw = process.argv[i + 1];
  if (raw.includes(',')) {
    const seeds = raw.split(',').map((s) => Number(s.trim()));
    if (seeds.some((s) => !Number.isFinite(s)))
      throw new Error('--seeds wants numbers');
    return seeds;
  }
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1)
    throw new Error('--seeds wants a count or a list');
  return Array.from({ length: count }, (_, k) => base + k);
}

const base: Omit<RunOptions, 'seed'> = {
  generations: arg('generations', 3),
  pop: arg('pop', CONFIG.defaultPopulation),
  width: arg('width', 1280),
  height: arg('height', 720),
  flyRate: arg('flyRate', CONFIG.defaultFlyRate),
};
const seeds = seedList(arg('seed', CONFIG.defaultSeed));
const threads = Math.max(
  1,
  Math.min(seeds.length, arg('threads', os.availableParallelism())),
);
const showGenomes = flag('genomes');

const tag = (seed: number) => (seeds.length > 1 ? `[seed ${seed}] ` : '');
function printGeneration(e: GenerationEvent): void {
  console.log(
    `${tag(e.seed)}gen ${e.generation}: best ${e.best.toFixed(0)} mean ${e.mean.toFixed(0)} prey ${e.prey} | ${e.ticks} ticks in ${e.ms.toFixed(0)} ms (${((e.ticks * DT) / e.ms).toFixed(1)}x)`,
  );
}

/** A pool of `threads` workers draining the seed queue, one run per worker. */
function runParallel(): Promise<RunSummary[]> {
  return new Promise((resolve, reject) => {
    const queue = [...seeds];
    const results: RunSummary[] = [];
    let running = 0;
    const next = () => {
      if (queue.length === 0) {
        if (running === 0) resolve(results);
        return;
      }
      const seed = queue.shift() as number;
      running++;
      const worker = new Worker(new URL('./run-worker.ts', import.meta.url), {
        workerData: { ...base, seed },
      });
      worker.on('message', (message) => {
        if (message.type === 'generation') printGeneration(message.event);
        else if (message.type === 'done') results.push(message.summary);
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        running--;
        if (code !== 0)
          reject(new Error(`seed ${seed}: worker exited with code ${code}`));
        else next();
      });
    };
    for (let i = 0; i < threads; i++) next();
  });
}

const wallStart = performance.now();
const summaries =
  seeds.length === 1
    ? [runSeed({ ...base, seed: seeds[0] }, printGeneration)]
    : await runParallel();
const wallMs = performance.now() - wallStart;

summaries.sort((a, b) => seeds.indexOf(a.seed) - seeds.indexOf(b.seed));
console.log('');
console.log('seed          gens  all-time best  last best / mean   speed');
for (const s of summaries) {
  const speed = (s.ticks * DT) / s.ms;
  console.log(
    `${String(s.seed).padEnd(13)} ${String(s.generations).padEnd(5)} ${s.allTimeBest.toFixed(0).padEnd(14)} ${`${s.lastBest.toFixed(0)} / ${s.lastMean.toFixed(0)}`.padEnd(18)} ${speed.toFixed(1)}x`,
  );
  if (showGenomes) {
    const rounded = Object.fromEntries(
      Object.entries(s.lastBestGenome).map(([k, v]) => [
        k,
        Number(v.toPrecision(3)),
      ]),
    );
    console.log(`  ${JSON.stringify(rounded)}`);
  }
}
const totalTicks = summaries.reduce((sum, s) => sum + s.ticks, 0);
console.log(
  `${summaries.length} run(s), ${totalTicks} ticks in ${(wallMs / 1000).toFixed(1)} s => ${((totalTicks * DT) / wallMs).toFixed(1)}x realtime aggregate on ${threads} thread(s)`,
);
