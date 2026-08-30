import { describe, expect, test } from '@rstest/core';
import { BASE_GENOME, CONFIG, FLY } from '../src/config';
import { PHYSICS } from '../src/physics/config';
import { stepPhysics } from '../src/physics/solver';
import { createSubdividedThread } from '../src/physics/world';
import { createAgent } from '../src/simulation/agents';
import {
  buildFrameWorld,
  getSilkProfile,
  startGeneration,
} from '../src/simulation/lifecycle';
import {
  physicsSkipped,
  resolveWithoutSolver,
  stepPrey,
} from '../src/simulation/prey';
import {
  createEvolutionState,
  createSimulationState,
} from '../src/simulation/state';
import { updateTick } from '../src/simulation/update';
import type {
  Agent,
  Fly,
  SilkType,
  SimulationControls,
  SimulationState,
} from '../src/types';

const WIDTH = 600;
const HEIGHT = 400;
const DT = 16;
const SEED = 4242;

/** A genome that never builds, so a scene stays exactly as the test set it up. */
const INERT = { ...BASE_GENOME, exploreDropRate: 0, angleGapThreshold: 1.5 };

function makeControls(
  overrides: Partial<SimulationControls> = {},
): SimulationControls {
  return {
    simSpeed: 1,
    flyRate: 0,
    targetPopulation: 1,
    immortality: true,
    ...overrides,
  };
}

/**
 * The arena substrate plus one inert spider. Prey is stepped by hand, so these
 * tests see the impact and nothing else.
 */
function arena(): { state: SimulationState; agent: Agent } {
  const state = createSimulationState(WIDTH, HEIGHT, SEED);
  state.active = true;
  buildFrameWorld(state);
  const agent = createAgent(0, { ...INERT }, state, CONFIG);
  agent.energy = CONFIG.startingEnergy;
  state.agents = [agent];
  return { state, agent };
}

/**
 * A single horizontal thread held taut across the arena. Every node of it is
 * pinned so the thread cannot sag out of the fly's way during the test; the
 * node the fly splits into is created free, so the impact itself is unchanged.
 */
function tautThread(
  state: SimulationState,
  agent: Agent,
  type: SilkType,
  y = 200,
): void {
  const thread = createSubdividedThread(
    state.world,
    150,
    y,
    450,
    y,
    getSilkProfile(type),
    type,
    agent.id,
    '#fff',
  );
  for (const springId of thread.springIds) {
    const spring = state.world.springMap.get(springId);
    if (!spring) continue;
    for (const nodeId of [spring.nodeA, spring.nodeB]) {
      const node = state.world.nodeMap.get(nodeId);
      if (node) node.pinned = true;
    }
  }
}

function makeFly(
  state: SimulationState,
  mass: number,
  speed: number,
  from: { x: number; y: number } = { x: 300, y: 150 },
  heading: { x: number; y: number } = { x: 0, y: 1 },
): Fly {
  const fly: Fly = {
    id: state.nextFlyId++,
    x: from.x,
    y: from.y,
    vx: heading.x * speed,
    vy: heading.y * speed,
    hx: heading.x,
    hy: heading.y,
    mass,
    ageMs: 0,
    nodeId: -1,
    ownerAgentId: -1,
    stuckMs: 0,
    graceMs: 0,
  };
  state.flies.push(fly);
  return fly;
}

/** One tick of prey + solver, in the same order `updateTick` runs them. */
function tick(state: SimulationState, controls: SimulationControls): void {
  stepPrey(state, controls, CONFIG, DT);
  if (!physicsSkipped(controls)) {
    stepPhysics(state.world, DT, PHYSICS.constraintIterations);
  }
}

interface Outcome {
  caught: boolean;
  everCoupled: boolean;
  brokeSilk: boolean;
  ticks: number;
}

/** Fly until the prey resolves one way or the other. */
function resolve(
  state: SimulationState,
  agent: Agent,
  controls: SimulationControls,
  maxTicks = 400,
): Outcome {
  const score = agent.score;
  const liveSilk = () =>
    state.world.springs.filter((s) => !s.broken && s.ownerAgentId === agent.id)
      .length;
  const before = liveSilk();
  let everCoupled = false;
  let couplings = 0;

  for (let i = 0; i < maxTicks; i++) {
    const wasCoupled = state.flies.some((f) => f.nodeId >= 0);
    tick(state, controls);
    const nowCoupled = state.flies.some((f) => f.nodeId >= 0);
    if (nowCoupled && !wasCoupled) {
      everCoupled = true;
      couplings++;
    }
    // A coupling splits one spring into two; anything else that removes a
    // spring is a break.
    const broke = before + couplings - liveSilk() > 0;
    if (agent.score > score)
      return { caught: true, everCoupled, brokeSilk: broke, ticks: i };
    if (state.flies.length === 0)
      return { caught: false, everCoupled, brokeSilk: broke, ticks: i };
  }
  return {
    caught: agent.score > score,
    everCoupled,
    brokeSilk: before + couplings - liveSilk() > 0,
    ticks: maxTicks,
  };
}

/** Repeat an impact with independent behaviour streams for the owner. */
function trials(
  build: () => { state: SimulationState; agent: Agent },
  shoot: (state: SimulationState) => void,
  count = 12,
): Outcome[] {
  const results: Outcome[] = [];
  for (let i = 0; i < count; i++) {
    const { state, agent } = build();
    agent.rng = state.rng.fork(`trial-${i}`);
    shoot(state);
    results.push(resolve(state, agent, makeControls()));
  }
  return results;
}

// ========== COUPLING AND CAPTURE ==========

describe('a fly is coupled into the web by the solver', () => {
  test('impact splits the thread and the new node carries the fly', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'capture');
    const springsBefore = state.world.springs.filter((s) => !s.broken).length;

    // Prey only, no solver step: this asserts the state at the moment of impact.
    const fly = makeFly(state, 0.4, 4);
    for (let i = 0; i < 30 && fly.nodeId < 0; i++)
      stepPrey(state, makeControls(), CONFIG, DT);

    expect(fly.nodeId).toBeGreaterThanOrEqual(0);
    expect(fly.ownerAgentId).toBe(agent.id);
    const node = state.world.nodeMap.get(fly.nodeId);
    expect(node?.mass).toBe(fly.mass);
    expect(node?.pinned).toBe(false);
    // The split replaced one spring with two.
    expect(state.world.springs.filter((s) => !s.broken).length).toBe(
      springsBefore + 1,
    );
    // Verlet velocity: the node was handed the fly's momentum.
    expect((node?.y ?? 0) - (node?.prevY ?? 0)).toBeCloseTo(fly.vy, 5);
  });

  test('a slow, light fly on taut capture silk is held and eaten', () => {
    const outcomes = trials(
      () => {
        const built = arena();
        tautThread(built.state, built.agent, 'capture');
        return built;
      },
      (state) => makeFly(state, FLY.minMass, FLY.minSpeed),
    );

    expect(outcomes.every((o) => o.everCoupled)).toBe(true);
    expect(outcomes.filter((o) => o.caught).length).toBeGreaterThanOrEqual(11);
    expect(outcomes.some((o) => o.brokeSilk)).toBe(false);
  });

  test('capture pays the owner in proportion to the prey it swallowed', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'capture');
    const energy = agent.energy;

    makeFly(state, FLY.maxMass, FLY.minSpeed);
    const outcome = resolve(state, agent, makeControls());

    expect(outcome.caught).toBe(true);
    expect(agent.score).toBe(1);
    expect(agent.energy - energy).toBeCloseTo(
      CONFIG.gainFly * (FLY.maxMass / FLY.referenceMass),
      5,
    );
    expect(agent.fliesCaught).toHaveLength(1);
    // The fly left the arena with the spider.
    expect(state.flies).toHaveLength(0);
  });

  test('capture is slower on radial silk than on capture silk', () => {
    const held = (type: SilkType) =>
      trials(
        () => {
          const built = arena();
          tautThread(built.state, built.agent, type);
          return built;
        },
        (state) => makeFly(state, 0.3, 4),
      ).filter((o) => o.caught).length;

    expect(held('capture')).toBeGreaterThan(held('radial'));
  });
});

// ========== BREAKING THROUGH ==========

describe('an overloaded impact tears the web', () => {
  test('a fast, heavy fly punches through sparse radial silk', () => {
    const outcomes = trials(
      () => {
        const built = arena();
        tautThread(built.state, built.agent, 'radial');
        return built;
      },
      (state) => makeFly(state, FLY.maxMass, FLY.maxSpeed),
    );

    expect(outcomes.every((o) => o.everCoupled)).toBe(true);
    expect(outcomes.filter((o) => o.caught)).toHaveLength(0);
    // The silk gave way rather than merely letting go.
    expect(outcomes.filter((o) => o.brokeSilk).length).toBeGreaterThanOrEqual(
      outcomes.length - 1,
    );
  });

  test('a fly that loses every thread at its node flies on', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'radial');
    const fly = makeFly(state, FLY.maxMass, FLY.maxSpeed);
    const controls = makeControls();

    for (let i = 0; i < 8 && fly.nodeId < 0; i++) tick(state, controls);
    expect(fly.nodeId).toBeGreaterThanOrEqual(0);

    for (let i = 0; i < 60 && fly.nodeId >= 0; i++) tick(state, controls);
    expect(fly.nodeId).toBe(-1);
    expect(agent.score).toBe(0);
    // Still airborne, still moving.
    expect(state.flies).toContain(fly);
    expect(Math.hypot(fly.vx, fly.vy)).toBeGreaterThan(0);
  });

  test('web damage from an impact persists', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'radial');
    const before = state.world.springs.filter(
      (s) => !s.broken && s.ownerAgentId === agent.id,
    ).length;

    makeFly(state, FLY.maxMass, FLY.maxSpeed);
    resolve(state, agent, makeControls());

    const after = state.world.springs.filter(
      (s) => !s.broken && s.ownerAgentId === agent.id,
    ).length;
    // A coupling adds one spring; the web still came out shorter.
    expect(after).toBeLessThan(before + 1);
  });
});

// ========== THE SUBSTRATE IS NOT A WEB ==========

describe('the frame catches nothing', () => {
  test('a fly crossing frame and branches is never coupled or caught', () => {
    const { state, agent } = arena(); // no silk at all: only frame + branches
    const controls = makeControls();
    const fly = makeFly(state, 0.5, 5, { x: 300, y: 20 }, { x: 0, y: 1 });

    for (let i = 0; i < 200 && state.flies.length > 0; i++) {
      tick(state, controls);
      expect(fly.nodeId).toBe(-1);
      expect(fly.ownerAgentId).toBe(-1);
    }

    expect(agent.score).toBe(0);
    expect(agent.fliesCaught).toHaveLength(0);
    expect(state.flies).toHaveLength(0);
  });

  test('the substrate is never damaged by prey', () => {
    const { state, agent } = arena();
    const frameSprings = state.world.springs.filter(
      (s) => s.ownerAgentId === -1,
    ).length;

    for (let i = 0; i < 6; i++) {
      makeFly(state, FLY.maxMass, FLY.maxSpeed, { x: 60 + i * 80, y: 20 });
      resolve(state, agent, makeControls(), 120);
    }

    expect(
      state.world.springs.filter((s) => !s.broken && s.ownerAgentId === -1)
        .length,
    ).toBe(frameSprings);
  });
});

// ========== HOUSEKEEPING ==========

describe('flies come and go', () => {
  test('a fly that leaves the arena despawns', () => {
    const { state } = arena();
    const controls = makeControls();
    makeFly(state, 0.3, 6, { x: 590, y: 60 }, { x: 1, y: 0 });

    for (let i = 0; i < 60 && state.flies.length > 0; i++)
      tick(state, controls);

    expect(state.flies).toHaveLength(0);
  });

  test('a coupled fly cannot hang on forever', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'capture');
    makeFly(state, 0.3, 3);

    const outcome = resolve(state, agent, makeControls(), 500);
    expect(outcome.ticks * DT).toBeLessThanOrEqual(FLY.holdMs + 200);
  });

  test('live flies are capped, and the prey stream does not notice', () => {
    const state = createSimulationState(WIDTH, HEIGHT, SEED);
    state.active = true;
    buildFrameWorld(state);
    state.agents = [];
    const controls = makeControls({ flyRate: 1 });

    for (let i = 0; i < 300; i++) stepPrey(state, controls, CONFIG, DT);

    expect(state.flies.length).toBeLessThanOrEqual(FLY.maxLive);
    // Every tick still drew a spawn, cap or no cap.
    expect(state.nextFlyId).toBe(300);
  });
});

// ========== FAST-FORWARD ==========

describe('fast-forward falls back without the solver', () => {
  const fast = makeControls({ simSpeed: PHYSICS.skipPhysicsSpeed });

  test('a slow, light fly is still mostly held by capture silk', () => {
    let caught = 0;
    for (let i = 0; i < 12; i++) {
      const { state, agent } = arena();
      tautThread(state, agent, 'capture');
      agent.rng = state.rng.fork(`ff-${i}`);
      const fly = makeFly(state, FLY.minMass, FLY.minSpeed);
      resolveWithoutSolver(state, CONFIG, fly);
      if (agent.score > 0) caught++;
    }
    expect(caught).toBeGreaterThanOrEqual(9);
  });

  test('an impact past the silk capacity breaks it instead', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'radial');
    const fly = makeFly(state, FLY.maxMass, FLY.maxSpeed * 2);

    const before = state.world.springs.filter(
      (s) => !s.broken && s.ownerAgentId === agent.id,
    ).length;
    resolveWithoutSolver(state, CONFIG, fly);

    expect(agent.score).toBe(0);
    expect(
      state.world.springs.filter(
        (s) => !s.broken && s.ownerAgentId === agent.id,
      ).length,
    ).toBe(before - 1);
  });

  test('a fly can never be left hanging while the solver is off', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'capture');
    makeFly(state, 0.3, 4);

    // Couple it for real, then switch into fast-forward.
    for (let i = 0; i < 30 && state.flies[0]?.nodeId < 0; i++)
      tick(state, makeControls());
    expect(state.flies[0]?.nodeId).toBeGreaterThanOrEqual(0);

    stepPrey(state, fast, CONFIG, DT);
    expect(state.flies).toHaveLength(0);
    expect(
      state.world.nodes.every((n) => n.mass === PHYSICS.defaultNodeMass),
    ).toBe(true);
  });

  test('the solver never runs, so no node moves', () => {
    const { state, agent } = arena();
    tautThread(state, agent, 'capture');
    const positions = state.world.nodes.map((n) => [n.x, n.y]);
    const controls = makeControls({
      simSpeed: PHYSICS.skipPhysicsSpeed,
      flyRate: 1,
    });

    for (let i = 0; i < 400; i++) updateTick(state, controls, CONFIG, DT);

    expect(state.world.nodes.map((n) => [n.x, n.y])).toEqual(positions);
    expect(state.nextFlyId).toBe(400);
    expect(agent.score).toBeGreaterThan(0);
  });
});

// ========== DETERMINISM ==========

describe('prey is reproducible', () => {
  function generation(seed: number, population: number, ticks: number) {
    const state = createSimulationState(WIDTH, HEIGHT, seed);
    const evolution = createEvolutionState();
    const controls = makeControls({
      flyRate: 0.5,
      targetPopulation: population,
      immortality: false,
    });
    startGeneration(state, evolution, controls, CONFIG);
    for (let i = 0; i < ticks; i++) updateTick(state, controls, CONFIG, DT);
    return state;
  }

  function digest(state: SimulationState) {
    return {
      spawned: state.nextFlyId,
      scores: state.agents.map((a) => a.score),
      energy: state.agents.map((a) => a.energy),
      flies: state.flies.map((f) => [
        f.id,
        f.x,
        f.y,
        f.vx,
        f.vy,
        f.nodeId,
        f.ownerAgentId,
        f.stuckMs,
      ]),
      caught: state.agents.map((a) => a.fliesCaught.length),
    };
  }

  test('the same seed replays every fly and every score', () => {
    expect(digest(generation(SEED, 3, 600))).toEqual(
      digest(generation(SEED, 3, 600)),
    );
  });

  test('a different seed gives different prey', () => {
    expect(digest(generation(SEED, 3, 600))).not.toEqual(
      digest(generation(SEED + 1, 3, 600)),
    );
  });

  test('the prey sequence does not depend on the population', () => {
    const small = generation(SEED, 2, 400);
    const large = generation(SEED, 8, 400);
    expect(small.nextFlyId).toBe(large.nextFlyId);
    expect(small.flyRng.next()).toBe(large.flyRng.next());
  });

  test('captures happen, and nothing goes non-finite', () => {
    const state = generation(SEED, 4, 1500);
    expect(state.agents.reduce((sum, a) => sum + a.score, 0)).toBeGreaterThan(
      0,
    );
    for (const fly of state.flies) {
      expect(Number.isFinite(fly.x)).toBe(true);
      expect(Number.isFinite(fly.y)).toBe(true);
      expect(Number.isFinite(fly.vx)).toBe(true);
      expect(Number.isFinite(fly.vy)).toBe(true);
    }
    for (const node of state.world.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});
