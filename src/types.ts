import type { PhysicsWorld } from './physics/types';
import type { Rng } from './rng';

export type SilkType = 'frame' | 'radial' | 'capture';

export interface SilkProfile {
  strength: number;
  extensibility: number;
  damping: number;
  adhesion: number;
  tension: number;
}

/** Which silk the agent is currently paying out. */
export type SilkMode = 'structural' | 'capture';

/**
 * Rule parameters, never shapes.
 *
 * Every field is a threshold, bias, gain or probability inside a sensor→action
 * rule. Nothing here names a geometric feature of the finished web: radial
 * count, spiral spacing and hub size are *consequences* of these numbers, and
 * may fail to appear at all.
 */
export interface Genome {
  // --- Construction rules ---
  /** rad, 0.2-1.5. Fill a bounded angular gap once it is wider than this. */
  angleGapThreshold: number;
  /** rad, 0-0.8. Random spread added to every launch direction. */
  buildNoise: number;
  /** 0.001-0.08. Per-16ms chance of an exploratory drop from the substrate. */
  exploreDropRate: number;
  /** 0-2. Pull of gravity on the chosen direction of an exploratory drop. */
  gravityBias: number;
  /** 0-2. Pull of sensed silk on the chosen direction of an exploratory drop. */
  structureAttraction: number;
  /** rad, 0.05-1.2. Switch to capture silk once the local gap falls below this. */
  captureSwitchThreshold: number;
  /** px, 8-90. Leg span: bridge when no capture thread is this close. */
  attachReach: number;

  // --- Junction choice biases ---
  /** -1..1. Prefer taut (>0) or slack (<0) threads. */
  tensionPreference: number;
  /** -1..1. Prefer own silk (>0) or the substrate (<0). */
  ownSilkPreference: number;
  /** 0-2. Prefer carrying on in the current heading. */
  headingInertia: number;
  /** 0-2. Prefer heading toward the most-connected node remembered so far. */
  hubAttraction: number;

  // --- Termination ---
  /** 1-40. Local own-silk density (length / sense radius) that stops building. */
  stopDensity: number;

  // --- Physical traits ---
  speed: number; // 0.5-2, crawling speed (and dragline launch speed)
  bodyMass: number; // 0.6-1.8, weight
  gravityScale: number; // 0.4-1.8, falling acceleration
}

export interface GenomeSnapshot {
  generation: number;
  genome: Genome;
}

export interface Agent {
  id: number;
  genome: Genome;
  /** Private behaviour stream, seeded as hash(generationSeed, id). */
  rng: Rng;
  alive: boolean;
  energy: number;
  /**
   * Energy this agent was born with (`startingEnergy * bodyMass`). Kept so
   * fitness can score the energy a spider *earned* rather than the energy it was
   * handed, which would otherwise pay a bonus for nothing but being heavy.
   */
  startEnergy: number;
  score: number;
  x: number;
  y: number;
  state: 'crawling' | 'falling';
  /** Current spring the agent is on */
  currentSpringId: number;
  /** Parametric position on current spring [0,1] */
  tOnSpring: number;
  direction: number;
  dropStartPos: { x: number; y: number } | null;
  /** Node the current dragline is anchored to, resolved when the drop starts. */
  dropStartNodeId: number | null;
  vx: number;
  vy: number;
  /** Thread IDs owned by this agent in the physics world */
  threadIds: number[];
  fliesCaught: Array<{ x: number; y: number; ageMs: number }>;
  color: string;
  webColor: string;
  legPhase: number;

  // --- Sensorimotor memory (discovered, never preset) ---
  /** Silk currently being paid out. Switched by a sensed-gap rule. */
  silkMode: SilkMode;
  /** False once local silk density passes `stopDensity`; re-checked per junction. */
  building: boolean;
  /** Direction of travel, radians. Feeds `headingInertia`. */
  heading: number;
  /** Pixels walked since the last thread was attached. Paces launches. */
  distanceSinceAttach: number;
  /** Most-connected own-silk node visited so far, or -1. The emergent "hub". */
  homeNodeId: number;
  /** Own-silk degree of `homeNodeId` when it was remembered. */
  homeDegree: number;
  /** Total length of silk paid out, px. Counts threads that later broke. */
  silkSpent: number;
}

/**
 * A prey item. Airborne it is a ballistic particle; on impact it becomes a
 * massive node inside the web (`nodeId`) and the solver takes over.
 */
export interface Fly {
  id: number;
  x: number;
  y: number;
  /** Velocity in px per 16 ms, matching the agent convention. */
  vx: number;
  vy: number;
  /** Unit heading, kept so a fly that struggles free knows where to go. */
  hx: number;
  hy: number;
  /** Node mass once coupled, in physics mass units. */
  mass: number;
  /** Total time alive, ms. */
  ageMs: number;
  /** Physics node the fly is coupled to, or -1 while airborne. */
  nodeId: number;
  /** Owner of the silk it is stuck to, or -1 while airborne. */
  ownerAgentId: number;
  /** Time coupled to the web, ms. Reset on every fresh impact. */
  stuckMs: number;
  /** Time left before the fly may couple again, ms. */
  graceMs: number;
}

/** Best/mean fitness of one completed generation. */
export interface GenerationRecord {
  generation: number;
  best: number;
  mean: number;
}

/**
 * What one spider's web cost and returned over a generation. Measured, never
 * prescribed: every number here is read off the world or off the agent's own
 * accounting at the end of the run.
 */
export interface WebMetrics {
  agentId: number;
  fitness: number;
  alive: boolean;
  energy: number;
  /** Flies actually eaten. */
  fliesCaught: number;
  /** Threads spun (each may be many springs). */
  threadCount: number;
  /** Total silk paid out over the generation, px, standing or not. */
  silkSpent: number;
  /** Length of the agent's silk still unbroken, px. */
  silkLength: number;
  /** Of `silkLength`, how much is capture silk, px. */
  captureLength: number;
}

export interface EvolutionState {
  generation: number;
  /** All-time best fitness seen in this run. */
  bestFitness: number;
  /** The genome that scored `bestFitness`. */
  bestGenome: Genome;
  /**
   * The persistent population. One genome per agent, index-aligned with
   * `state.agents` while a generation runs; bred into the next population by
   * `evolvePopulation` at generation end.
   */
  population: Genome[];
  /** Fitness of every member of the last evaluated population, index-aligned. */
  lastFitness: number[];
  /** Best/mean fitness per completed generation, newest last. */
  fitnessHistory: GenerationRecord[];
  history: GenomeSnapshot[];
}

export interface SimulationState {
  active: boolean;
  genTimer: number;
  width: number;
  height: number;
  world: PhysicsWorld;
  /** Frame thread IDs (top, right, bottom, left + branches) */
  frameThreadIds: number[];
  agents: Agent[];
  globalTime: number;
  /** Root seed for the whole run; every other stream derives from it. */
  seed: number;
  /** Seed of the current generation: hash(seed, 'gen', generation). */
  generationSeed: number;
  /** General simulation stream for the current generation. */
  rng: Rng;
  /**
   * Prey stream for the current generation. Kept separate from `rng` so the
   * fly sequence is identical no matter what the agents do.
   */
  flyRng: Rng;
  /** Prey currently in the arena, airborne or coupled to a web. */
  flies: Fly[];
  /** Id counter for `flies`. */
  nextFlyId: number;
  /**
   * Flies the prey stream has produced this generation. Purely a function of
   * the seed, the fly rate and the tick schedule — never of what the webs do —
   * so it is the denominator that makes fitness comparable across generations.
   */
  fliesSpawned: number;
  /** Ticks since the last physics-world cleanup. */
  cleanupCounter: number;
}

/**
 * Everything the *simulation* can be told from outside. Deliberately free of
 * any notion of speed: how many ticks run per wall-clock second is the
 * scheduler's business (`src/engine/scheduler.ts`), and the simulation must
 * come out identical whatever that number is.
 */
export interface SimulationControls {
  flyRate: number;
  targetPopulation: number;
  immortality: boolean;
}

export interface UIRefs {
  gen: HTMLElement;
  timer: HTMLElement;
  pop: HTMLElement;
  bar: HTMLElement;
  val: HTMLElement;
  dnaGap: HTMLElement;
  dnaExplore: HTMLElement;
  dnaReach: HTMLElement;
  dnaSwitch: HTMLElement;
  dnaMass: HTMLElement;
  bestFit: HTMLElement;
  meanFit: HTMLElement;
  webSilk: HTMLElement;
  webCapture: HTMLElement;
  webThreads: HTMLElement;
  webFlies: HTMLElement;
  popInput: HTMLInputElement;
  food: HTMLInputElement;
  speedBtn: HTMLButtonElement;
  graphicsBtn: HTMLButtonElement;
  engineVal: HTMLElement;
  rateVal: HTMLElement;
  log: HTMLElement;
  uiLayer: HTMLElement;
  toggleBtn: HTMLButtonElement;
  genomeChart: HTMLCanvasElement;
  immortalBtn: HTMLButtonElement;
}

export interface UiStats {
  generation: number;
  timerMs: number;
  activeCount: number;
  avgEnergy: number;
  /** All-time best fitness of the run. */
  bestFitness: number;
  /** Best fitness of the last completed generation. */
  genBestFitness: number;
  /** Mean fitness of the last completed generation. */
  meanFitness: number;
  /** Web metrics of the last generation's best agent, if there was one. */
  bestMetrics: WebMetrics | null;
  bestGenome: Genome;
  /** Speed the user asked for; `Infinity` is Max. */
  targetSpeed: number;
  /** Speed actually achieved over the last second, or null if unknown yet. */
  measuredSpeed: number | null;
  flyRate: number;
  targetPopulation: number;
  maxEnergy: number;
  genomeHistory: GenomeSnapshot[];
  immortality: boolean;
}

/** What the simulation controller itself can report; the engine adds speed. */
export type SimStats = Omit<UiStats, 'targetSpeed' | 'measuredSpeed'>;

export type LogType = 'highlight' | 'danger' | '';
