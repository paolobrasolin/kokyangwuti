import type { PhysicsWorld } from './physics/types';

export type SilkType = 'frame' | 'radial' | 'capture';

export interface SilkProfile {
  strength: number;
  extensibility: number;
  damping: number;
  adhesion: number;
  tension: number;
}

export type BuildPhase = 'explore' | 'radial' | 'spiral' | 'done';

export interface Genome {
  // Web architecture
  radialCount: number;     // 8-32, number of radial spokes
  spiralSpacing: number;   // 0.02-0.08, gap between spiral turns (fraction of web radius)
  hubSize: number;         // 0.05-0.2, hub free zone (fraction of web radius)

  // Construction behavior
  buildPrecision: number;  // 0.3-1.0, aiming accuracy for drops
  anchorCount: number;     // 2-5, structural threads before hub is established

  // Physical traits
  speed: number;           // 0.5-3, crawling speed
  bodyMass: number;        // 0.6-1.8, weight
  gravityScale: number;    // 0.4-1.8, falling acceleration
}

export interface GenomeSnapshot {
  generation: number;
  genome: Genome;
}

export interface Agent {
  id: number;
  genome: Genome;
  alive: boolean;
  energy: number;
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
  vx: number;
  vy: number;
  /** Thread IDs owned by this agent in the physics world */
  threadIds: number[];
  fliesCaught: Array<{ x: number; y: number; ageMs: number }>;
  color: string;
  webColor: string;
  legPhase: number;

  // Construction state machine
  buildPhase: BuildPhase;
  hubX: number;
  hubY: number;
  webRadius: number;
  currentAngle: number;
  radialsBuilt: number;
  spiralRadius: number;
  spiralAngle: number;
  anchorPoints: Array<{ x: number; y: number }>;
  crawlTarget: { x: number; y: number } | null;
  crawlTimer: number;
}

export interface EvolutionState {
  generation: number;
  bestFitness: number;
  bestGenome: Genome;
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
}

export interface SimulationControls {
  simSpeed: number;
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
  dnaDrop: HTMLElement;
  dnaSpeed: HTMLElement;
  dnaBias: HTMLElement;
  dnaJump: HTMLElement;
  dnaMass: HTMLElement;
  bestFit: HTMLElement;
  popInput: HTMLInputElement;
  food: HTMLInputElement;
  speedBtn: HTMLButtonElement;
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
  bestFitness: number;
  bestGenome: Genome;
  simSpeed: number;
  flyRate: number;
  targetPopulation: number;
  maxEnergy: number;
  genomeHistory: GenomeSnapshot[];
  immortality: boolean;
}

export interface RenderSnapshot {
  world: PhysicsWorld;
  agents: Agent[];
  width: number;
  height: number;
  globalTime: number;
}

export type LogType = 'highlight' | 'danger' | '';
