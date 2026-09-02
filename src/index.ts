import './index.css';
import { CONFIG, SPEED_STEPS } from './config';
import { createEngine } from './engine/client';
import { startRenderLoop } from './loop';
import { resizeCanvas, setupCanvas } from './render/canvas';
import { draw, drawIdle } from './render/draw';
import { bindUI } from './ui/bind';
import { buildUI } from './ui/build';
import { createLogger, renderUI, type ViewState } from './ui/presenter';

const IDLE_LINES = [
  'graphics off',
  'the simulation is still running; stats update above',
] as const;

const { ui, canvas } = buildUI();
const logger = createLogger(ui, CONFIG.logMaxEntries);
const ctx = setupCanvas(canvas);
resizeCanvas(canvas, window.innerWidth, window.innerHeight);

let speedIndex = 0;
let immortal = false;

// The simulation lives in a worker where it can: it keeps its pace while the
// tab is hidden, and the page only ever draws what it is handed.
const engine = createEngine({
  width: canvas.width,
  height: canvas.height,
  controls: {
    speed: SPEED_STEPS[speedIndex],
    flyRate: CONFIG.defaultFlyRate,
    population: CONFIG.defaultPopulation,
    immortality: immortal,
  },
});
engine.onLog(logger);

const view: ViewState = { engine: engine.kind, graphics: true };

function handleResize(): void {
  resizeCanvas(canvas, window.innerWidth, window.innerHeight);
  engine.resize(canvas.width, canvas.height);
  if (!view.graphics) drawIdle(ctx, canvas.width, canvas.height, IDLE_LINES);
}
window.addEventListener('resize', handleResize);

bindUI(ui, {
  onSpeedChange: () => {
    speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
    const speed = SPEED_STEPS[speedIndex];
    engine.setControls({ speed });
    return speed;
  },
  onPopulationChange: (value) => engine.setControls({ population: value }),
  onFlyRateChange: (value) => engine.setControls({ flyRate: value }),
  onTogglePanel: () => {},
  onImmortalToggle: () => {
    immortal = !immortal;
    engine.setControls({ immortality: immortal });
    return immortal;
  },
  onGraphicsToggle: () => {
    view.graphics = !view.graphics;
    if (!view.graphics) drawIdle(ctx, canvas.width, canvas.height, IDLE_LINES);
    return view.graphics;
  },
});

startRenderLoop({
  engine,
  wantsRender: () => view.graphics,
  onFrame: (stats, frame) => {
    renderUI(ui, stats, view);
    if (frame) draw(ctx, frame);
  },
});
