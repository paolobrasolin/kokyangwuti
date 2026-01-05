import type { LogType, UiStats, UIRefs } from '../types';

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
  const bestFitness = Number.isFinite(stats.bestFitness) ? stats.bestFitness : 0;
  ui.bestFit.textContent = bestFitness.toFixed(0);
  ui.speedBtn.textContent = `Speed: ${stats.simSpeed}x`;
  ui.popInput.value = String(stats.targetPopulation);
  ui.food.value = String(Math.round(stats.flyRate * 200));
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
