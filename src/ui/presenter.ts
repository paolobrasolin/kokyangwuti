import { GENOME_RANGES } from '../config';
import type { EngineKind } from '../engine/client';
import type { Genome, LogType, UIRefs, UiStats } from '../types';

/** Page-side state the presenter shows alongside the simulation's stats. */
export interface ViewState {
  engine: EngineKind;
  graphics: boolean;
}

/** "12x" style: one decimal below ten, whole numbers above. */
export function formatSpeed(speed: number): string {
  return speed >= 10 ? speed.toFixed(0) : speed.toFixed(1);
}

/**
 * The speed button's label. The measured speed is shown in brackets whenever
 * it is the more honest number: always for Max, and for a fixed target only
 * when the machine is falling noticeably short of it.
 */
export function speedLabel(target: number, measured: number | null): string {
  if (!Number.isFinite(target)) {
    return measured === null
      ? 'Speed: Max'
      : `Speed: Max (${formatSpeed(measured)}x)`;
  }
  const lagging = measured !== null && measured < target * 0.85;
  return lagging
    ? `Speed: ${target}x (${formatSpeed(measured)}x)`
    : `Speed: ${target}x`;
}

const LABEL_COLORS: Record<string, string> = {
  angleGapThreshold: '#4fc3f7',
  exploreDropRate: '#ffb74d',
  attachReach: '#ba68c8',
  captureSwitchThreshold: '#81c784',
  bodyMass: '#f06292',
};

export function renderUI(ui: UIRefs, stats: UiStats, view: ViewState): void {
  ui.gen.textContent = `GEN ${stats.generation}`;
  ui.timer.textContent = `${(stats.timerMs / 1000).toFixed(1)}s`;
  ui.pop.textContent = String(stats.activeCount);

  const energyPercent =
    stats.maxEnergy > 0
      ? Math.min(100, (stats.avgEnergy / stats.maxEnergy) * 100)
      : 0;
  ui.bar.style.width = `${energyPercent}%`;
  ui.val.textContent = stats.avgEnergy.toFixed(0);

  ui.dnaGap.textContent = `${stats.bestGenome.angleGapThreshold.toFixed(2)} rad`;
  ui.dnaExplore.textContent = stats.bestGenome.exploreDropRate.toFixed(3);
  ui.dnaReach.textContent = `${stats.bestGenome.attachReach.toFixed(0)} px`;
  ui.dnaSwitch.textContent = `${stats.bestGenome.captureSwitchThreshold.toFixed(2)} rad`;
  ui.dnaMass.textContent = stats.bestGenome.bodyMass.toFixed(2);

  ui.dnaGap.style.color = LABEL_COLORS.angleGapThreshold;
  ui.dnaExplore.style.color = LABEL_COLORS.exploreDropRate;
  ui.dnaReach.style.color = LABEL_COLORS.attachReach;
  ui.dnaSwitch.style.color = LABEL_COLORS.captureSwitchThreshold;
  ui.dnaMass.style.color = LABEL_COLORS.bodyMass;
  const bestFitness = Number.isFinite(stats.bestFitness)
    ? stats.bestFitness
    : 0;
  ui.bestFit.textContent = bestFitness.toFixed(0);
  ui.meanFit.textContent = `${stats.genBestFitness.toFixed(0)} / ${stats.meanFitness.toFixed(0)}`;

  const web = stats.bestMetrics;
  ui.webSilk.textContent = web ? `${web.silkSpent.toFixed(0)} px` : '--';
  ui.webCapture.textContent = web ? `${web.captureLength.toFixed(0)} px` : '--';
  ui.webThreads.textContent = web ? String(web.threadCount) : '--';
  ui.webFlies.textContent = web ? String(web.fliesCaught) : '--';

  ui.speedBtn.textContent = speedLabel(stats.targetSpeed, stats.measuredSpeed);
  ui.rateVal.textContent =
    stats.measuredSpeed === null
      ? '--'
      : `${formatSpeed(stats.measuredSpeed)}x`;
  ui.engineVal.textContent =
    view.engine === 'worker' ? 'background thread' : 'page thread';
  ui.graphicsBtn.textContent = view.graphics ? 'Graphics: On' : 'Graphics: Off';
  ui.popInput.value = String(stats.targetPopulation);
  ui.food.value = String(Math.round(stats.flyRate * 200));
  ui.immortalBtn.textContent = stats.immortality
    ? 'Immortal: On'
    : 'Immortal: Off';

  renderGenomeChart(ui.genomeChart, stats.genomeHistory);
}

const PLOTTED: Array<{ key: keyof Genome; color: string }> = [
  { key: 'angleGapThreshold', color: '#4fc3f7' },
  { key: 'exploreDropRate', color: '#ffb74d' },
  { key: 'attachReach', color: '#ba68c8' },
  { key: 'captureSwitchThreshold', color: '#81c784' },
  { key: 'bodyMass', color: '#f06292' },
  { key: 'stopDensity', color: '#64b5f6' },
  { key: 'hubAttraction', color: '#90a4ae' },
  { key: 'speed', color: '#ffd54f' },
];

const PARAM_META = PLOTTED.map(({ key, color }) => ({
  key,
  color,
  min: GENOME_RANGES[key][0],
  max: GENOME_RANGES[key][1],
}));

function renderGenomeChart(
  canvas: HTMLCanvasElement,
  history: UiStats['genomeHistory'],
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const windowed = history.slice(-128);
  if (windowed.length < 2) return;
  const firstGen = windowed[0].generation;
  const lastGen = windowed[windowed.length - 1].generation;
  const span = Math.max(1, lastGen - firstGen);

  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, 10);
  ctx.lineTo(30, h - 10);
  ctx.lineTo(w - 10, h - 10);
  ctx.stroke();

  PARAM_META.forEach((param) => {
    ctx.strokeStyle = param.color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    windowed.forEach((snapshot, idx) => {
      const x = 30 + ((snapshot.generation - firstGen) / span) * (w - 40);
      const val = snapshot.genome[param.key] ?? 0;
      const norm = (val - param.min) / Math.max(0.0001, param.max - param.min);
      const y = h - 10 - Math.max(0, Math.min(1, norm)) * (h - 30);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

export function createLogger(
  ui: UIRefs,
  maxEntries: number,
): (message: string, type?: LogType) => void {
  return (message, type = '') => {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.textContent = `> ${message}`;
    ui.log.prepend(div);
    while (ui.log.children.length > maxEntries) {
      ui.log.lastChild?.remove();
    }
  };
}
