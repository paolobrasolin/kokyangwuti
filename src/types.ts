export type SilkType = 'frame' | 'radial' | 'capture';

export interface SilkProfile {
  strength: number;
  extensibility: number;
  damping: number;
  adhesion: number;
  tension: number;
}

export interface Line extends SilkProfile {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  id: number;
  color: string;
  type: SilkType;
}

export interface Genome {
  dropRate: number;
  glide: number;
  speed: number;
  bias: number;
  radialPreference: number;
  spiralDrift: number;
  gravityScale: number;
  jumpPower: number;
  bodyMass: number;
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
  currentLineIdx: number;
  t: number;
  direction: number;
  dropStartPos: { x: number; y: number } | null;
  vx: number;
  vy: number;
  lines: Line[];
  fliesCaught: Array<{ x: number; y: number; ageMs: number }>;
  color: string;
  webColor: string;
  legPhase: number;
}

export interface EvolutionState {
  generation: number;
  bestFitness: number;
  bestGenome: Genome;
}

export interface SimulationState {
  active: boolean;
  genTimer: number;
  width: number;
  height: number;
  frameLines: Line[];
  agents: Agent[];
  globalTime: number;
}

export interface SimulationControls {
  simSpeed: number;
  flyRate: number;
  targetPopulation: number;
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
}

export interface RenderSnapshot {
  frameLines: Line[];
  agents: Agent[];
  width: number;
  height: number;
  globalTime: number;
}

export type LogType = 'highlight' | 'danger' | '';
