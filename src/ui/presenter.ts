import type { LogType, UiStats, UIRefs } from '../types';

const LABEL_COLORS: Record<string, string> = {
  dropRate: '#4fc3f7',
  radialPreference: '#ffb74d',
  spiralDrift: '#ba68c8',
  jumpPower: '#81c784',
  bodyMass: '#f06292',
};

export function renderUI(ui: UIRefs, stats: UiStats): void {
  ui.gen.textContent = `GEN ${stats.generation}`;
  ui.timer.textContent = `${(stats.timerMs / 1000).toFixed(1)}s`;
  ui.pop.textContent = String(stats.activeCount);

  const energyPercent = stats.maxEnergy > 0 ? Math.min(100, (stats.avgEnergy / stats.maxEnergy) * 100) : 0;
  ui.bar.style.width = `${energyPercent}%`;
  ui.val.textContent = stats.avgEnergy.toFixed(0);

  ui.dnaDrop.textContent = stats.bestGenome.dropRate.toFixed(3);
  ui.dnaSpeed.textContent = stats.bestGenome.radialPreference.toFixed(2);
  ui.dnaBias.textContent = stats.bestGenome.spiralDrift.toFixed(2);
  ui.dnaJump.textContent = stats.bestGenome.jumpPower.toFixed(2);
  ui.dnaMass.textContent = stats.bestGenome.bodyMass.toFixed(2);

  ui.dnaDrop.style.color = LABEL_COLORS.dropRate;
  ui.dnaSpeed.style.color = LABEL_COLORS.radialPreference;
  ui.dnaBias.style.color = LABEL_COLORS.spiralDrift;
  ui.dnaJump.style.color = LABEL_COLORS.jumpPower;
  ui.dnaMass.style.color = LABEL_COLORS.bodyMass;
  const bestFitness = Number.isFinite(stats.bestFitness) ? stats.bestFitness : 0;
  ui.bestFit.textContent = bestFitness.toFixed(0);
  ui.speedBtn.textContent = `Speed: ${stats.simSpeed}x`;
  ui.popInput.value = String(stats.targetPopulation);
  ui.food.value = String(Math.round(stats.flyRate * 200));
  ui.immortalBtn.textContent = stats.immortality ? 'Immortal: On' : 'Immortal: Off';

  renderGenomeChart(ui.genomeChart, stats.genomeHistory);
}

const PARAM_META = [
  { key: 'dropRate', color: '#4fc3f7', min: 0, max: 0.05 },
  { key: 'radialPreference', color: '#ffb74d', min: 0, max: 1 },
  { key: 'spiralDrift', color: '#ba68c8', min: 0, max: 1.5 },
  { key: 'jumpPower', color: '#81c784', min: 0, max: 2.5 },
  { key: 'bodyMass', color: '#f06292', min: 0.6, max: 1.8 },
  { key: 'glide', color: '#64b5f6', min: 0, max: 5 },
  { key: 'gravityScale', color: '#90a4ae', min: 0.4, max: 1.8 },
  { key: 'speed', color: '#ffd54f', min: 0.5, max: 3 },
  { key: 'bias', color: '#aed581', min: 0, max: 1 },
];

function renderGenomeChart(canvas: HTMLCanvasElement, history: UiStats['genomeHistory']): void {
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
      const val = (snapshot.genome as any)[param.key] ?? 0;
      const norm = (val - param.min) / Math.max(0.0001, param.max - param.min);
      const y = h - 10 - Math.max(0, Math.min(1, norm)) * (h - 30);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

export function createLogger(ui: UIRefs, maxEntries: number): (message: string, type?: LogType) => void {
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
