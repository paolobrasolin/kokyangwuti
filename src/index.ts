import './index.css';
import { CONFIG } from './config';
import { startLoop } from './loop';
import { draw } from './render/draw';
import { resizeCanvas, setupCanvas } from './render/canvas';
import { createSimulationController } from './simulation/controller';
import { buildUI } from './ui/build';
import { bindUI } from './ui/bind';
import { createLogger, renderUI } from './ui/presenter';

const { ui, canvas } = buildUI();
const logger = createLogger(ui, CONFIG.logMaxEntries);

const controller = createSimulationController({
  config: CONFIG,
  logger,
  onNewBest: (fitness) => {
    const best = Number.isFinite(fitness) ? fitness : 0;
    ui.bestFit.textContent = best.toFixed(0);
  },
});

const ctx = setupCanvas(canvas);

function handleResize(): void {
  resizeCanvas(canvas, window.innerWidth, window.innerHeight);
  controller.resize(canvas.width, canvas.height);
}

handleResize();
window.addEventListener('resize', handleResize);

bindUI(ui, {
  onSpeedChange: () => controller.cycleSpeed(),
  onPopulationChange: (value) => controller.setPopulation(value),
  onFlyRateChange: (value) => controller.setFlyRate(value),
  onTogglePanel: () => {},
  onImmortalToggle: () => controller.toggleImmortality(),
});

controller.start();
renderUI(ui, controller.update(0));

startLoop({
  getSimSpeed: controller.getSimSpeed,
  update: (dt) => {
    const stats = controller.update(dt);
    renderUI(ui, stats);
    return stats;
  },
  render: () => draw(ctx, controller.getSnapshot()),
});
