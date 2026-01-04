import './index.css';

// --- Constants & Config ---
const STARTING_ENERGY = 2000;
const COST_CRAWL = 0.05;
const COST_DROP_START = 20;
const COST_DROP_PIXEL = 0.2;
const GAIN_FLY = 1000;
const GEN_DURATION_MS = 60000;

// --- Types ---
interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  id: number;
  color: string;
}

interface Genome {
  dropRate: number;
  glide: number;
  speed: number;
  bias: number;
}

interface Agent {
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
  fliesCaught: Array<{ x: number; y: number }>;
  color: string;
  webColor: string;
  legPhase: number;
}

interface EvolutionState {
  generation: number;
  bestFitness: number;
  bestGenome: Genome;
}

interface SimulationState {
  active: boolean;
  genTimer: number;
  width: number;
  height: number;
  frameLines: Line[];
  agents: Agent[];
}

interface UIElements {
  gen: HTMLElement;
  timer: HTMLElement;
  pop: HTMLElement;
  bar: HTMLElement;
  val: HTMLElement;
  dnaDrop: HTMLElement;
  dnaSpeed: HTMLElement;
  dnaBias: HTMLElement;
  bestFit: HTMLElement;
  popInput: HTMLInputElement;
  food: HTMLInputElement;
  speedBtn: HTMLButtonElement;
  log: HTMLElement;
  uiLayer: HTMLElement;
}

// --- Globals ---
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let ui: UIElements;

let simSpeed = 1;
let flyRate = 0.1; // Probability of fly appearing per frame
let targetPopulation = 8;
let globalTime = 0;

// --- State ---
const evolution: EvolutionState = {
  generation: 1,
  bestFitness: -Infinity,
  bestGenome: {
    dropRate: 0.015,
    glide: 0.5,
    speed: 1.0,
    bias: 0.35,
  },
};

const state: SimulationState = {
  active: true,
  genTimer: 0,
  width: 0,
  height: 0,
  frameLines: [], // Shared boundary
  agents: [],
};

// --- Init ---
function createHTMLStructure() {
  // Create UI Layer
  const uiLayer = document.createElement('div');
  uiLayer.id = 'ui-layer';

  const h1 = document.createElement('h1');
  const span1 = document.createElement('span');
  span1.textContent = 'AI.Swarm.Parallel';
  const span2 = document.createElement('span');
  span2.id = 'gen-counter';
  span2.textContent = 'GEN 1';
  h1.appendChild(span1);
  h1.appendChild(span2);
  uiLayer.appendChild(h1);

  const statRow1 = document.createElement('div');
  statRow1.className = 'stat-row';
  const label1 = document.createElement('span');
  label1.className = 'stat-label';
  label1.textContent = 'Time Remaining:';
  const val1 = document.createElement('span');
  val1.id = 'timer-text';
  val1.className = 'stat-val';
  val1.textContent = '--';
  statRow1.appendChild(label1);
  statRow1.appendChild(val1);
  uiLayer.appendChild(statRow1);

  const statRow2 = document.createElement('div');
  statRow2.className = 'stat-row';
  const label2 = document.createElement('span');
  label2.className = 'stat-label';
  label2.textContent = 'Active Agents:';
  const val2 = document.createElement('span');
  val2.id = 'pop-count';
  val2.className = 'stat-val';
  val2.textContent = '0';
  statRow2.appendChild(label2);
  statRow2.appendChild(val2);
  uiLayer.appendChild(statRow2);

  const statRow3 = document.createElement('div');
  statRow3.className = 'stat-row';
  statRow3.style.marginTop = '10px';
  const label3 = document.createElement('span');
  label3.className = 'stat-label';
  label3.textContent = 'Avg Efficiency:';
  const val3 = document.createElement('span');
  val3.id = 'energy-val';
  val3.className = 'stat-val';
  val3.textContent = '100%';
  statRow3.appendChild(label3);
  statRow3.appendChild(val3);
  uiLayer.appendChild(statRow3);

  const barContainer = document.createElement('div');
  barContainer.className = 'bar-container';
  const barFill = document.createElement('div');
  barFill.id = 'energy-bar';
  barFill.className = 'bar-fill';
  barContainer.appendChild(barFill);
  uiLayer.appendChild(barContainer);

  const dnaDisplay = document.createElement('div');
  dnaDisplay.className = 'dna-display';
  const dnaTitle = document.createElement('span');
  dnaTitle.className = 'dna-title';
  dnaTitle.textContent = 'BEHAVIORAL GENOME (ANCESTOR)';
  dnaDisplay.appendChild(dnaTitle);

  const dnaRow1 = document.createElement('div');
  dnaRow1.className = 'stat-row';
  const dnaLabel1 = document.createElement('span');
  dnaLabel1.className = 'stat-label';
  dnaLabel1.textContent = 'Drop Rate:';
  const dnaVal1 = document.createElement('span');
  dnaVal1.id = 'dna-drop';
  dnaVal1.className = 'stat-val';
  dnaVal1.textContent = '--';
  dnaRow1.appendChild(dnaLabel1);
  dnaRow1.appendChild(dnaVal1);
  dnaDisplay.appendChild(dnaRow1);

  const dnaRow2 = document.createElement('div');
  dnaRow2.className = 'stat-row';
  const dnaLabel2 = document.createElement('span');
  dnaLabel2.className = 'stat-label';
  dnaLabel2.textContent = 'Glide Factor:';
  const dnaVal2 = document.createElement('span');
  dnaVal2.id = 'dna-speed';
  dnaVal2.className = 'stat-val';
  dnaVal2.textContent = '--';
  dnaRow2.appendChild(dnaLabel2);
  dnaRow2.appendChild(dnaVal2);
  dnaDisplay.appendChild(dnaRow2);

  const dnaRow3 = document.createElement('div');
  dnaRow3.className = 'stat-row';
  const dnaLabel3 = document.createElement('span');
  dnaLabel3.className = 'stat-label';
  dnaLabel3.textContent = 'Vertical Bias:';
  const dnaVal3 = document.createElement('span');
  dnaVal3.id = 'dna-bias';
  dnaVal3.className = 'stat-val';
  dnaVal3.textContent = '--';
  dnaRow3.appendChild(dnaLabel3);
  dnaRow3.appendChild(dnaVal3);
  dnaDisplay.appendChild(dnaRow3);

  uiLayer.appendChild(dnaDisplay);

  const controlGroup1 = document.createElement('div');
  controlGroup1.className = 'control-group';
  const popLabel = document.createElement('label');
  popLabel.textContent = 'Population Size';
  controlGroup1.appendChild(popLabel);
  const popInput = document.createElement('input');
  popInput.type = 'range';
  popInput.id = 'pop-input';
  popInput.min = '1';
  popInput.max = '50';
  popInput.value = '8';
  popInput.step = '1';
  controlGroup1.appendChild(popInput);
  uiLayer.appendChild(controlGroup1);

  const controlGroup2 = document.createElement('div');
  controlGroup2.className = 'control-group';
  const foodLabel = document.createElement('label');
  foodLabel.textContent = 'Fly Rate (Z-Axis Traffic)';
  controlGroup2.appendChild(foodLabel);
  const foodInput = document.createElement('input');
  foodInput.type = 'range';
  foodInput.id = 'food-input';
  foodInput.min = '0';
  foodInput.max = '200';
  foodInput.value = '50';
  foodInput.step = '1';
  controlGroup2.appendChild(foodInput);
  uiLayer.appendChild(controlGroup2);

  const speedBtn = document.createElement('button');
  speedBtn.id = 'speed-btn';
  speedBtn.textContent = 'Speed: 1x';
  uiLayer.appendChild(speedBtn);

  const statRow4 = document.createElement('div');
  statRow4.className = 'stat-row';
  const fitnessLabel = document.createElement('span');
  fitnessLabel.className = 'stat-label';
  fitnessLabel.textContent = 'Max Fitness:';
  const val4 = document.createElement('span');
  val4.id = 'best-fitness';
  val4.className = 'stat-val highlight';
  val4.textContent = '0.0';
  statRow4.appendChild(fitnessLabel);
  statRow4.appendChild(val4);
  uiLayer.appendChild(statRow4);

  const logConsole = document.createElement('div');
  logConsole.id = 'log-console';
  uiLayer.appendChild(logConsole);

  document.body.appendChild(uiLayer);

  // Create Toggle Button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'toggle-ui';
  toggleBtn.title = 'Toggle UI';
  toggleBtn.textContent = '_';
  document.body.appendChild(toggleBtn);

  // Create Canvas
  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'sim-canvas';
  document.body.appendChild(canvasEl);

  // Get references
  canvas = canvasEl;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get 2d context');
  }
  ctx = context;

  ui = {
    gen: span2,
    timer: val1,
    pop: val2,
    bar: barFill,
    val: val3,
    dnaDrop: dnaVal1,
    dnaSpeed: dnaVal2,
    dnaBias: dnaVal3,
    bestFit: val4,
    popInput: popInput,
    food: foodInput,
    speedBtn: speedBtn,
    log: logConsole,
    uiLayer: uiLayer,
  };
}

function init() {
  createHTMLStructure();
  resize();
  window.addEventListener('resize', resize);
  ui.speedBtn.addEventListener('click', () => {
    if (simSpeed === 1) simSpeed = 5;
    else if (simSpeed === 5) simSpeed = 20;
    else if (simSpeed === 20) simSpeed = 100;
    else if (simSpeed === 100) simSpeed = 1000;
    else if (simSpeed === 1000) simSpeed = 10000;
    else simSpeed = 1;
    ui.speedBtn.textContent = `Speed: ${simSpeed}x`;
  });
  ui.popInput.addEventListener('input', (e) => {
    targetPopulation = parseInt((e.target as HTMLInputElement).value);
  });
  ui.food.addEventListener('input', (e) => {
    flyRate = parseFloat((e.target as HTMLInputElement).value) / 200;
  });
  const toggleBtn = document.getElementById('toggle-ui');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      ui.uiLayer.style.opacity = ui.uiLayer.style.opacity === '0' ? '1' : '0';
    });
  }

  startGeneration();
  requestAnimationFrame(loop);
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  state.width = canvas.width;
  state.height = canvas.height;
}

function log(msg: string, type = '') {
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  div.textContent = `> ${msg}`;
  ui.log.prepend(div);
  if (ui.log.children.length > 6) ui.log.lastChild?.remove();
}

// --- Core Simulation ---

function startGeneration() {
  state.genTimer = 0;
  state.active = true;

  // Build Shared Frame
  const w = state.width;
  const h = state.height;
  const frameColor = 'rgba(50,50,80,0.3)';
  state.frameLines = [
    { x1: 0, y1: 0, x2: w, y2: 0, id: 0, color: frameColor }, // Top
    { x1: w, y1: 0, x2: w, y2: h, id: 1, color: frameColor }, // Right
    { x1: w, y1: h, x2: 0, y2: h, id: 2, color: frameColor }, // Bottom
    { x1: 0, y1: h, x2: 0, y2: 0, id: 3, color: frameColor }, // Left
  ];

  // Agents
  state.agents = [];
  for (let i = 0; i < targetPopulation; i++) {
    const genome = mutate(evolution.bestGenome);
    state.agents.push(createAgent(i, genome));
  }

  ui.gen.textContent = `GEN ${evolution.generation}`;
  ui.dnaDrop.textContent = evolution.bestGenome.dropRate.toFixed(3);
  ui.dnaSpeed.textContent = evolution.bestGenome.glide.toFixed(2);
  ui.dnaBias.textContent = evolution.bestGenome.bias.toFixed(2);
  log(`Gen ${evolution.generation} Started`);
}

function mutate(g: Genome): Genome {
  const n = { ...g };
  if (Math.random() < 0.4)
    n.dropRate = Math.max(
      0.001,
      Math.min(0.1, n.dropRate + (Math.random() - 0.5) * 0.01),
    );
  if (Math.random() < 0.4)
    n.glide = Math.max(
      0.0,
      Math.min(5.0, n.glide + (Math.random() - 0.5) * 0.5),
    );
  if (Math.random() < 0.4)
    n.speed = Math.max(
      0.5,
      Math.min(3.0, n.speed + (Math.random() - 0.5) * 0.2),
    );
  if (Math.random() < 0.4)
    n.bias = Math.max(0.0, Math.min(1.0, n.bias + (Math.random() - 0.5) * 0.2));
  return n;
}

function createAgent(id: number, genome: Genome): Agent {
  const startX = Math.random() * state.width;
  const hue = Math.random() * 360;
  return {
    id: id,
    genome: genome,
    alive: true,
    energy: STARTING_ENERGY,
    score: 0,
    // Physics State
    x: startX,
    y: 0,
    state: 'crawling', // 'crawling', 'falling'
    // Crawling State
    currentLineIdx: 0,
    t: startX / state.width,
    direction: Math.random() < 0.5 ? 1 : -1,
    // Falling/Gliding State
    dropStartPos: null,
    vx: 0,
    vy: 0,
    // Private World
    lines: [], // Own web lines
    fliesCaught: [], // Visual record of flies caught on own web
    // Visuals
    color: `hsl(${hue}, 100%, 60%)`,
    webColor: `hsla(${hue}, 100%, 70%, 0.4)`,
    legPhase: Math.random() * 10,
  };
}

function endGeneration() {
  state.active = false;
  let best: Agent | null = null;
  let maxFit = -Infinity;
  state.agents.forEach((a) => {
    let fit = a.energy + a.score * 1500;
    if (!a.alive) fit = -1000 + a.score * 500;
    if (fit > maxFit) {
      maxFit = fit;
      best = a;
    }
  });

  if (best && maxFit > -500) {
    if (maxFit > evolution.bestFitness) {
      evolution.bestFitness = maxFit;
      ui.bestFit.textContent = maxFit.toFixed(0);
      log('New Best Genome!', 'highlight');
    }
    evolution.bestGenome = { ...best.genome };
  } else {
    log('Colony Failed. Retrying.', 'danger');
  }

  evolution.generation++;
  setTimeout(startGeneration, 100);
}

// --- Logic Update ---

function update(dt: number) {
  if (!state.active) return;
  state.genTimer += dt;
  globalTime += dt * 0.01;

  ui.timer.textContent =
    ((GEN_DURATION_MS - state.genTimer) / 1000).toFixed(1) + 's';
  if (state.genTimer >= GEN_DURATION_MS) endGeneration();

  // Flies (Z-Axis Logic)
  const chance = 1 - Math.pow(1 - flyRate, dt / 16);
  if (Math.random() < chance) {
    attemptFlyCross();
  }

  // Agents
  let activeCount = 0;
  let totalE = 0;
  state.agents.forEach((a) => {
    if (!a.alive) return;
    activeCount++;
    totalE += a.energy;

    a.energy -= 0.05 * (dt / 16);
    if (a.energy <= 0) {
      a.alive = false;
      a.energy = 0;
      return;
    }

    if (a.state === 'crawling') updateCrawl(a, dt);
    else if (a.state === 'falling') updateFall(a, dt);
  });

  ui.pop.textContent = String(activeCount);
  const avgE = activeCount ? totalE / activeCount : 0;
  ui.bar.style.width = Math.min(100, (avgE / STARTING_ENERGY) * 100) + '%';
  ui.val.textContent = avgE.toFixed(0);

  if (activeCount === 0 && state.genTimer > 1000) endGeneration();
}

function attemptFlyCross() {
  const fx = Math.random() * state.width;
  const fy = Math.random() * state.height;

  state.agents.forEach((a) => {
    if (!a.alive) return;
    let caught = false;

    for (const l of a.lines) {
      const d = distToSegment(fx, fy, l.x1, l.y1, l.x2, l.y2);
      if (d < 5) {
        caught = true;
        break;
      }
    }

    if (caught) {
      a.score++;
      a.energy += GAIN_FLY;
      a.fliesCaught.push({ x: fx, y: fy });
      if (a.fliesCaught.length > 50) a.fliesCaught.shift();
    }
  });
}

function updateCrawl(a: Agent, dt: number) {
  const line =
    a.currentLineIdx < 4
      ? state.frameLines[a.currentLineIdx]
      : a.lines[a.currentLineIdx - 4];

  if (!line) return;

  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const speed = (2 + a.genome.speed * 2) * (dt / 16);
  const tStep = len > 0 ? speed / len : 0;

  a.t += tStep * a.direction;
  a.x = line.x1 + (line.x2 - line.x1) * a.t;
  a.y = line.y1 + (line.y2 - line.y1) * a.t;
  a.energy -= COST_CRAWL * speed;

  // Handle End of Line
  if (a.t <= 0 || a.t >= 1) {
    a.t = a.t <= 0 ? 0 : 1;
    const px = a.t === 0 ? line.x1 : line.x2;
    const py = a.t === 0 ? line.y1 : line.y2;

    // Find connected lines (Frame + Private Web)
    const connected: Array<{ idx: number; startT: number }> = [];
    // Check Frame
    state.frameLines.forEach((l, idx) => {
      if (idx === a.currentLineIdx) return;
      const d1 = Math.hypot(l.x1 - px, l.y1 - py);
      const d2 = Math.hypot(l.x2 - px, l.y2 - py);
      if (d1 < 1) connected.push({ idx, startT: 0 });
      else if (d2 < 1) connected.push({ idx, startT: 1 });
    });
    // Check Private Web
    a.lines.forEach((l, i) => {
      const realIdx = i + 4;
      if (realIdx === a.currentLineIdx) return;
      const d1 = Math.hypot(l.x1 - px, l.y1 - py);
      const d2 = Math.hypot(l.x2 - px, l.y2 - py);
      if (d1 < 1) connected.push({ idx: realIdx, startT: 0 });
      else if (d2 < 1) connected.push({ idx: realIdx, startT: 1 });
    });

    if (connected.length > 0) {
      const options = connected.map((c) => {
        const l = c.idx < 4 ? state.frameLines[c.idx] : a.lines[c.idx - 4];
        const otherY = c.startT === 0 ? l.y2 : l.y1;
        const isUp = otherY < a.y;
        return { ...c, isUp };
      });

      const wantUp = Math.random() > a.genome.bias;
      const preferred = options.filter((o) => o.isUp === wantUp);
      const candidates = preferred.length > 0 ? preferred : options;
      const next = candidates[Math.floor(Math.random() * candidates.length)];

      a.currentLineIdx = next.idx;
      a.t = next.startT;
      a.direction = next.startT === 0 ? 1 : -1;
    } else {
      a.direction *= -1;
    }
  }

  // Decision: Drop
  const dropProb = 1 - Math.pow(1 - a.genome.dropRate, dt / 16);
  if (Math.random() < dropProb) {
    a.state = 'falling';
    a.dropStartPos = { x: a.x, y: a.y };
    a.vy = 2.0;
    a.vx = a.direction * (Math.random() * a.genome.glide);
    if (Math.random() < 0.2) a.vx *= -1;
    a.energy -= COST_DROP_START;
  }
}

function updateFall(a: Agent, dt: number) {
  const nextX = a.x + a.vx * (dt / 16);
  const nextY = a.y + a.vy * (dt / 16);

  a.energy -= COST_DROP_PIXEL * Math.hypot(a.vx, a.vy);

  // Check Collision with OWN lines + Frame (Parallel Reality)
  let hit: { idx: number; x: number; y: number } | null = null;
  let minT = Infinity;

  const checkList = (list: Line[], offsetIdx: number) => {
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const result = getIntersection(
        a.x,
        a.y,
        nextX,
        nextY,
        l.x1,
        l.y1,
        l.x2,
        l.y2,
      );
      if (result && a.dropStartPos) {
        const distFromStart = Math.hypot(
          result.x - a.dropStartPos.x,
          result.y - a.dropStartPos.y,
        );
        if (distFromStart > 2) {
          const distToHit = Math.hypot(result.x - a.x, result.y - a.y);
          if (distToHit < minT) {
            minT = distToHit;
            hit = { idx: i + offsetIdx, x: result.x, y: result.y };
          }
        }
      }
    }
  };

  checkList(state.frameLines, 0);
  checkList(a.lines, 4);

  if (!hit) {
    if (nextY >= state.height)
      hit = { idx: 2, x: nextX, y: state.height }; // Bottom
    else if (nextX <= 0)
      hit = { idx: 3, x: 0, y: nextY }; // Left
    else if (nextX >= state.width) hit = { idx: 1, x: state.width, y: nextY }; // Right
  }

  if (hit) {
    // Landed!
    // CONSTRAINT: No Same-Side Frame Connections
    const startIsFrame = a.currentLineIdx < 4;
    const endIsFrame = hit.idx < 4;
    const sameSide = startIsFrame && endIsFrame && a.currentLineIdx === hit.idx;

    if (!sameSide && a.dropStartPos) {
      a.lines.push({
        x1: a.dropStartPos.x,
        y1: a.dropStartPos.y,
        x2: hit.x,
        y2: hit.y,
        id: a.lines.length,
        color: a.webColor,
      });
    }

    a.state = 'crawling';
    a.x = hit.x;
    a.y = hit.y;
    a.currentLineIdx = hit.idx;

    const l = hit.idx < 4 ? state.frameLines[hit.idx] : a.lines[hit.idx - 4];
    const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
    const dist = Math.hypot(a.x - l.x1, a.y - l.y1);
    a.t = len > 0 ? dist / len : 0;
    a.direction = Math.random() < 0.5 ? 1 : -1;
  } else {
    a.x = nextX;
    a.y = nextY;
  }
}

// --- Helpers ---
function getIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): { x: number; y: number } | null {
  const det = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (det === 0) return null;
  const lambda = ((y4 - y3) * (x4 - x1) + (x3 - x4) * (y4 - y1)) / det;
  const gamma = ((y1 - y2) * (x4 - x1) + (x2 - x1) * (y4 - y1)) / det;
  if (0 <= lambda && lambda <= 1 && 0 <= gamma && gamma <= 1) {
    return {
      x: x1 + lambda * (x2 - x1),
      y: y1 + lambda * (y2 - y1),
    };
  }
  return null;
}

function distToSegment(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq != 0) param = dot / len_sq;
  let xx: number, yy: number;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  const dx = x - xx;
  const dy = y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// --- Render ---
function loop(timestamp: number) {
  let steps = 1;
  if (simSpeed >= 10) steps = 5;
  if (simSpeed >= 100) steps = 20;
  if (simSpeed >= 1000) steps = 50;
  if (simSpeed >= 10000) steps = 100;

  const dt = (16 * simSpeed) / steps;

  for (let i = 0; i < steps; i++) {
    update(dt);
  }

  draw();
  requestAnimationFrame(loop);
}

function draw() {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, state.width, state.height);

  // Draw Frame
  ctx.lineWidth = 2;
  state.frameLines.forEach((l) => {
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.strokeStyle = '#333';
    ctx.stroke();
  });

  // Draw Agents and their Private Worlds
  state.agents.forEach((a) => {
    if (!a.alive) return;

    // Web
    ctx.lineWidth = 1;
    a.lines.forEach((l) => {
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1);
      ctx.lineTo(l.x2, l.y2);
      ctx.strokeStyle = l.color;
      ctx.stroke();
    });

    // Caught Flies
    ctx.fillStyle = '#ffaa00';
    a.fliesCaught.forEach((f) => {
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // Dragline
    if (a.state === 'falling' && a.dropStartPos) {
      ctx.strokeStyle = a.webColor;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(a.dropStartPos.x, a.dropStartPos.y);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }

    // Body
    ctx.save();
    ctx.translate(a.x, a.y);
    if (a.state === 'crawling') {
      const l =
        a.currentLineIdx < 4
          ? state.frameLines[a.currentLineIdx]
          : a.lines[a.currentLineIdx - 4];
      if (l) {
        const ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
        ctx.rotate(ang);
      }
    } else {
      const ang = Math.atan2(a.vy, a.vx);
      ctx.rotate(ang);
    }

    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = a.color;
    if (a.alive) {
      const wiggle = Math.sin(globalTime * 10 + a.legPhase) * 2;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-5 * i, -8 + wiggle);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(5 * i, -8 - wiggle);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-8 * i, 8 + wiggle);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(8 * i, 8 - wiggle);
        ctx.stroke();
      }
    }
    ctx.restore();
  });
}

// Start the application
init();
