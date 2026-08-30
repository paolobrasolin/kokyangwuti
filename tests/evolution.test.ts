import { describe, expect, test } from '@rstest/core';
import { BASE_GENOME, CONFIG, GENOME_RANGES } from '../src/config';
import { createRng } from '../src/rng';
import {
  computeFitness,
  crossover,
  ELITE_COUNT,
  evolvePopulation,
  FITNESS,
  GENOME_KEYS,
  initialPopulation,
  measureWeb,
  normalizeFitness,
  REFERENCE_PREY,
  randomGenome,
  rankedOrder,
  resizePopulation,
  tournament,
} from '../src/simulation/evolution';
import { endGeneration, startGeneration } from '../src/simulation/lifecycle';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type { Genome, SimulationControls } from '../src/types';

const WIDTH = 480;
const HEIGHT = 320;
const DT = 16;

function inRange(genome: Genome): boolean {
  return GENOME_KEYS.every((key) => {
    const [min, max] = GENOME_RANGES[key];
    const value = genome[key];
    return Number.isFinite(value) && value >= min && value <= max;
  });
}

/** A population of `size` distinguishable genomes. */
function population(size: number): Genome[] {
  const rng = createRng(1234);
  return Array.from({ length: size }, () => randomGenome(rng));
}

// ========== FITNESS ==========

describe('computeFitness', () => {
  test('a living spider is worth the energy it earned plus what it caught', () => {
    expect(
      computeFitness({ alive: true, energy: 900, startEnergy: 900, score: 0 }),
    ).toBe(0);
    expect(
      computeFitness({ alive: true, energy: 1800, startEnergy: 900, score: 0 }),
    ).toBe(900);
    expect(
      computeFitness({ alive: true, energy: 1800, startEnergy: 900, score: 2 }),
    ).toBe(900 + 2 * FITNESS.scoreWeight);
  });

  test('burning more than you were born with is worth less than nothing', () => {
    expect(
      computeFitness({ alive: true, energy: 400, startEnergy: 900, score: 0 }),
    ).toBe(-500);
  });

  test('a heavier birth ration buys no fitness by itself', () => {
    // The bodyMass loophole: birth energy is `startingEnergy * bodyMass`, so
    // scoring the final balance paid the heavy spider for being heavy. Two
    // spiders that end the generation exactly where they started must tie.
    const light = computeFitness({
      alive: true,
      energy: CONFIG.startingEnergy * 0.6,
      startEnergy: CONFIG.startingEnergy * 0.6,
      score: 3,
    });
    const heavy = computeFitness({
      alive: true,
      energy: CONFIG.startingEnergy * 1.8,
      startEnergy: CONFIG.startingEnergy * 1.8,
      score: 3,
    });
    expect(heavy).toBe(light);
  });

  test('death is punished but the catches still count', () => {
    expect(
      computeFitness({ alive: false, energy: 0, startEnergy: 2000, score: 0 }),
    ).toBe(FITNESS.deathPenalty);
    expect(
      computeFitness({ alive: false, energy: 0, startEnergy: 2000, score: 3 }),
    ).toBe(FITNESS.deathPenalty + 3 * FITNESS.deadScoreWeight);
  });

  test('a dead spider that fed well beats a live one that caught nothing', () => {
    const starved = computeFitness({
      alive: true,
      energy: 10,
      startEnergy: 2000,
      score: 0,
    });
    const productive = computeFitness({
      alive: false,
      energy: 0,
      startEnergy: 2000,
      score: 4,
    });
    expect(productive).toBeGreaterThan(starved);
  });

  test('energy is ignored once dead (only the catches carry over)', () => {
    expect(
      computeFitness({
        alive: false,
        energy: 5000,
        startEnergy: 2000,
        score: 1,
      }),
    ).toBe(
      computeFitness({ alive: false, energy: 0, startEnergy: 900, score: 1 }),
    );
  });
});

describe('normalizeFitness', () => {
  test('is the identity at the reference prey supply', () => {
    expect(normalizeFitness(1234, REFERENCE_PREY)).toBe(1234);
  });

  test('a lean generation is scaled up and a fat one down', () => {
    expect(normalizeFitness(1000, REFERENCE_PREY / 2)).toBe(2000);
    expect(normalizeFitness(1000, REFERENCE_PREY * 2)).toBe(500);
  });

  test('ranking within a generation is untouched', () => {
    const raw = [-3200, 1500, 40, 99000];
    const scaled = raw.map((f) => normalizeFitness(f, 61));
    const order = (xs: number[]) =>
      xs.map((_, i) => i).sort((a, b) => xs[b] - xs[a]);
    expect(order(scaled)).toEqual(order(raw));
  });

  test('an empty prey supply does not divide by zero', () => {
    expect(Number.isFinite(normalizeFitness(500, 0))).toBe(true);
  });

  test('a non-finite fitness passes through untouched', () => {
    expect(normalizeFitness(Number.NEGATIVE_INFINITY, 10)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

// ========== FOUNDERS ==========

describe('initial population', () => {
  test('keeps the base genome as founder 0 and randomizes the rest', () => {
    const founders = initialPopulation(8, createRng(7));
    expect(founders).toHaveLength(8);
    expect(founders[0]).toEqual(BASE_GENOME);
    expect(founders[1]).not.toEqual(BASE_GENOME);
    for (const genome of founders) expect(inRange(genome)).toBe(true);
  });

  test('is reproducible from its stream and diverges with the seed', () => {
    expect(initialPopulation(6, createRng(7))).toEqual(
      initialPopulation(6, createRng(7)),
    );
    expect(initialPopulation(6, createRng(8))).not.toEqual(
      initialPopulation(6, createRng(7)),
    );
  });

  test('a population of one is just the base genome', () => {
    expect(initialPopulation(1, createRng(7))).toEqual([BASE_GENOME]);
  });

  test('randomGenome spans the documented ranges', () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i++) expect(inRange(randomGenome(rng))).toBe(true);
  });
});

// ========== SELECTION PRIMITIVES ==========

describe('ranking and tournaments', () => {
  test('rankedOrder sorts by fitness, ties by index', () => {
    const pop = population(4);
    expect(rankedOrder(pop, [10, 40, 40, 5])).toEqual([1, 2, 0, 3]);
  });

  test('rankedOrder puts non-finite fitness last', () => {
    const pop = population(3);
    expect(rankedOrder(pop, [Number.NaN, -50, 0])).toEqual([2, 1, 0]);
  });

  test('a tournament of k=1 is uniform, k=3 favours the fit', () => {
    const pop = population(4);
    const fitnesses = [0, 0, 0, 1000];
    const rng = createRng(5);
    let wins = 0;
    for (let i = 0; i < 400; i++) {
      if (tournament(pop, fitnesses, rng) === pop[3]) wins++;
    }
    // P(the best of 4 appears in 3 uniform draws) = 1 - (3/4)^3 ~= 0.58.
    expect(wins).toBeGreaterThan(180);
    expect(wins).toBeLessThan(320);
  });

  test('a tournament always draws the same number of values', () => {
    const pop = population(4);
    const flat = createRng(11);
    const spread = createRng(11);
    tournament(pop, [0, 0, 0, 0], flat);
    tournament(pop, [1, 2, 3, 4], spread);
    // Stream position must not depend on who won.
    expect(flat.next()).toBe(spread.next());
  });
});

describe('uniform crossover', () => {
  const low: Genome = { ...BASE_GENOME };
  const high: Genome = { ...BASE_GENOME };
  for (const key of GENOME_KEYS) {
    low[key] = GENOME_RANGES[key][0];
    high[key] = GENOME_RANGES[key][1];
  }

  test('every field comes from one parent or the other', () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const child = crossover(low, high, rng);
      for (const key of GENOME_KEYS) {
        expect([low[key], high[key]]).toContain(child[key]);
      }
    }
  });

  test('a child mixes fields from both parents', () => {
    const child = crossover(low, high, createRng(3));
    const fromLow = GENOME_KEYS.filter((k) => child[k] === low[k]).length;
    const fromHigh = GENOME_KEYS.filter((k) => child[k] === high[k]).length;
    expect(fromLow).toBeGreaterThan(0);
    expect(fromHigh).toBeGreaterThan(0);
    expect(fromLow + fromHigh).toBe(GENOME_KEYS.length);
  });

  test('successive children of the same parents differ', () => {
    const rng = createRng(3);
    const first = crossover(low, high, rng);
    const second = crossover(low, high, rng);
    expect(second).not.toEqual(first);
  });
});

// ========== THE GENERATIONAL STEP ==========

describe('evolvePopulation', () => {
  const pop = population(8);
  const fitnesses = [100, -50, 900, 0, 450, 20, -1000, 300];

  test('is a pure function of (population, fitnesses, stream)', () => {
    const a = evolvePopulation(pop, fitnesses, createRng(42));
    const b = evolvePopulation(pop, fitnesses, createRng(42));
    expect(b).toEqual(a);
  });

  test('a different stream gives a different population', () => {
    const a = evolvePopulation(pop, fitnesses, createRng(42));
    const b = evolvePopulation(pop, fitnesses, createRng(43));
    expect(b).not.toEqual(a);
    // The elites are the same, so divergence must be in the offspring.
    expect(b.slice(0, ELITE_COUNT)).toEqual(a.slice(0, ELITE_COUNT));
    expect(b.slice(ELITE_COUNT)).not.toEqual(a.slice(ELITE_COUNT));
  });

  test('different fitnesses select differently', () => {
    const a = evolvePopulation(pop, fitnesses, createRng(42));
    const reversed = [...fitnesses].reverse();
    const b = evolvePopulation(pop, reversed, createRng(42));
    expect(b).not.toEqual(a);
  });

  test('elitism carries the top genomes through unchanged', () => {
    const next = evolvePopulation(pop, fitnesses, createRng(42));
    expect(next[0]).toEqual(pop[2]); // fitness 900
    expect(next[1]).toEqual(pop[4]); // fitness 450
    // Copies, not aliases: mutating the child must not touch the parent.
    expect(next[0]).not.toBe(pop[2]);
  });

  test('every offspring stays inside GENOME_RANGES', () => {
    for (let seed = 0; seed < 25; seed++) {
      for (const genome of evolvePopulation(pop, fitnesses, createRng(seed))) {
        expect(inRange(genome)).toBe(true);
      }
    }
  });

  test('offspring are not all copies of the elites', () => {
    const next = evolvePopulation(pop, fitnesses, createRng(42));
    const distinct = new Set(next.map((g) => JSON.stringify(g)));
    expect(distinct.size).toBeGreaterThan(ELITE_COUNT);
  });

  test('population size is preserved by default', () => {
    expect(evolvePopulation(pop, fitnesses, createRng(1))).toHaveLength(
      pop.length,
    );
  });

  test('a target size grows or shrinks the population', () => {
    expect(evolvePopulation(pop, fitnesses, createRng(1), 20)).toHaveLength(20);
    expect(evolvePopulation(pop, fitnesses, createRng(1), 3)).toHaveLength(3);
    // Even below the elite count the best genome survives.
    const tiny = evolvePopulation(pop, fitnesses, createRng(1), 1);
    expect(tiny).toEqual([pop[2]]);
  });

  test('an empty population is refounded rather than left empty', () => {
    const founded = evolvePopulation([], [], createRng(1), 5);
    expect(founded).toHaveLength(5);
    expect(founded[0]).toEqual(BASE_GENOME);
  });
});

describe('resizePopulation', () => {
  const pop = population(6);

  test('a matching size returns copies, not aliases', () => {
    const same = resizePopulation(pop, 6, createRng(1));
    expect(same).toEqual(pop);
    expect(same[0]).not.toBe(pop[0]);
  });

  test('shrinking keeps the head (where the elites live)', () => {
    expect(resizePopulation(pop, 2, createRng(1))).toEqual(pop.slice(0, 2));
  });

  test('growing fills with in-range mutants of the survivors', () => {
    const grown = resizePopulation(pop, 10, createRng(1));
    expect(grown).toHaveLength(10);
    expect(grown.slice(0, 6)).toEqual(pop);
    for (const genome of grown) expect(inRange(genome)).toBe(true);
  });

  test('is deterministic', () => {
    expect(resizePopulation(pop, 10, createRng(1))).toEqual(
      resizePopulation(pop, 10, createRng(1)),
    );
  });
});

// ========== DOES SELECTION ACTUALLY CLIMB? ==========

/**
 * The arena is a shared, prey-limited competition, so population mean fitness
 * there is pinned by the fly supply and cannot be used to show that selection
 * works. This is the clean control: a synthetic landscape where the optimum is
 * known, driven through the very same `evolvePopulation`.
 */
describe('selection optimizes', () => {
  const target = randomGenome(createRng(1));

  const distance = (genome: Genome): number => {
    let error = 0;
    for (const key of GENOME_KEYS) {
      const [min, max] = GENOME_RANGES[key];
      const d = (genome[key] - target[key]) / (max - min);
      error += d * d;
    }
    return -error;
  };

  test('a population converges on a known optimum', () => {
    let pop = initialPopulation(10, createRng(2));
    const trace: number[] = [];
    for (let generation = 0; generation < 40; generation++) {
      const fitnesses = pop.map(distance);
      trace.push(Math.max(...fitnesses));
      pop = evolvePopulation(pop, fitnesses, createRng(generation));
    }
    const start = trace[0];
    const end = Math.max(...pop.map(distance));

    expect(end).toBeGreaterThan(start * 0.2);
    // Elitism means the champion can never get worse.
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
    }
  });
});

// ========== END TO END ==========

function makeControls(targetPopulation: number): SimulationControls {
  return {
    simSpeed: 1,
    flyRate: 0.3,
    targetPopulation,
    immortality: false,
  };
}

/** Run `generations` complete generations headlessly and report what happened. */
function runGenerations(seed: number, generations: number, ticks: number) {
  const state = createSimulationState(WIDTH, HEIGHT, seed);
  const controls = makeControls(6);
  const evolution = createEvolutionState(seed, controls.targetPopulation);
  const reports = [];

  for (let g = 0; g < generations; g++) {
    startGeneration(state, evolution, controls, CONFIG);
    for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, DT);
    reports.push(endGeneration(state, evolution));
  }

  return { state, evolution, reports };
}

describe('generations end to end', () => {
  test('the same seed produces identical populations and fitnesses', () => {
    const a = runGenerations(20260829, 2, 300);
    const b = runGenerations(20260829, 2, 300);

    expect(b.evolution.population).toEqual(a.evolution.population);
    expect(b.evolution.lastFitness).toEqual(a.evolution.lastFitness);
    expect(b.evolution.fitnessHistory).toEqual(a.evolution.fitnessHistory);
    expect(b.reports.map((r) => r.bestFitness)).toEqual(
      a.reports.map((r) => r.bestFitness),
    );
    expect(b.reports.map((r) => r.metrics)).toEqual(
      a.reports.map((r) => r.metrics),
    );
  });

  test('a different seed diverges', () => {
    const a = runGenerations(20260829, 2, 300);
    const b = runGenerations(4242, 2, 300);
    expect(b.evolution.population).not.toEqual(a.evolution.population);
  });

  test('the population persists: it is bred, not re-rolled from one champion', () => {
    const { evolution, reports } = runGenerations(20260829, 2, 300);
    expect(evolution.population).toHaveLength(6);
    // The elites of the last generation survived verbatim.
    const survivors = new Set(
      evolution.population.map((g) => JSON.stringify(g)),
    );
    expect(survivors.size).toBeGreaterThan(1);
    expect(reports).toHaveLength(2);
    expect(evolution.generation).toBe(3);
  });

  test('the winning genome is carried into the chart history', () => {
    const { evolution, reports } = runGenerations(20260829, 2, 300);
    const last = evolution.history[evolution.history.length - 1];
    expect(last.genome).toEqual(reports[1].genome);
  });

  test('web metrics describe what each spider actually built', () => {
    const { state, reports } = runGenerations(20260829, 1, 600);
    const metrics = reports[0].metrics;
    expect(metrics).toHaveLength(state.agents.length);

    for (const web of metrics) {
      expect(web.silkSpent).toBeGreaterThan(0);
      expect(web.silkLength).toBeGreaterThan(0);
      expect(web.captureLength).toBeLessThanOrEqual(web.silkLength);
      expect(web.threadCount).toBeGreaterThan(0);
      expect(web.fliesCaught).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(web.fitness)).toBe(true);
    }

    const best = reports[0].bestMetrics;
    expect(best).not.toBeNull();
    if (best) {
      expect(best.fitness).toBe(reports[0].bestFitness);
      expect(Math.max(...metrics.map((m) => m.fitness))).toBe(best.fitness);
    }
  });

  test('measureWeb reads the world, not the agent', () => {
    const { state } = runGenerations(20260829, 1, 400);
    const agent = state.agents[0];
    const before = measureWeb(state.world, agent);
    for (const spring of state.world.springs) {
      if (spring.ownerAgentId === agent.id) spring.broken = true;
    }
    const after = measureWeb(state.world, agent);
    expect(after.silkLength).toBe(0);
    expect(before.silkLength).toBeGreaterThan(0);
    // Silk already paid for is still paid for.
    expect(after.silkSpent).toBe(before.silkSpent);
  });
});
