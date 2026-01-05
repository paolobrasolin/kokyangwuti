import type { UIRefs } from '../types';

export function buildUI(): { ui: UIRefs; canvas: HTMLCanvasElement } {
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
  dnaLabel2.textContent = 'Radial Pref:';
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
  dnaLabel3.textContent = 'Spiral Drift:';
  const dnaVal3 = document.createElement('span');
  dnaVal3.id = 'dna-bias';
  dnaVal3.className = 'stat-val';
  dnaVal3.textContent = '--';
  dnaRow3.appendChild(dnaLabel3);
  dnaRow3.appendChild(dnaVal3);
  dnaDisplay.appendChild(dnaRow3);

  const dnaRow4 = document.createElement('div');
  dnaRow4.className = 'stat-row';
  const dnaLabel4 = document.createElement('span');
  dnaLabel4.className = 'stat-label';
  dnaLabel4.textContent = 'Jump Power:';
  const dnaVal4 = document.createElement('span');
  dnaVal4.id = 'dna-jump';
  dnaVal4.className = 'stat-val';
  dnaVal4.textContent = '--';
  dnaRow4.appendChild(dnaLabel4);
  dnaRow4.appendChild(dnaVal4);
  dnaDisplay.appendChild(dnaRow4);

  const dnaRow5 = document.createElement('div');
  dnaRow5.className = 'stat-row';
  const dnaLabel5 = document.createElement('span');
  dnaLabel5.className = 'stat-label';
  dnaLabel5.textContent = 'Body Mass:';
  const dnaVal5 = document.createElement('span');
  dnaVal5.id = 'dna-mass';
  dnaVal5.className = 'stat-val';
  dnaVal5.textContent = '--';
  dnaRow5.appendChild(dnaLabel5);
  dnaRow5.appendChild(dnaVal5);
  dnaDisplay.appendChild(dnaRow5);

  const chartCanvas = document.createElement('canvas');
  chartCanvas.id = 'genome-chart';
  chartCanvas.width = 256;
  chartCanvas.height = 256;
  chartCanvas.style.marginTop = '8px';
  chartCanvas.style.width = '100%';
  chartCanvas.style.maxWidth = '256px';
  chartCanvas.style.height = '256px';
  chartCanvas.style.maxHeight = '256px';
  dnaDisplay.appendChild(chartCanvas);

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

  const immortalBtn = document.createElement('button');
  immortalBtn.id = 'immortal-btn';
  immortalBtn.textContent = 'Immortal: Off';
  uiLayer.appendChild(immortalBtn);

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

  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'toggle-ui';
  toggleBtn.title = 'Toggle UI';
  toggleBtn.textContent = '_';
  document.body.appendChild(toggleBtn);

  const canvas = document.createElement('canvas');
  canvas.id = 'sim-canvas';
  document.body.appendChild(canvas);

  const uiRefs: UIRefs = {
    gen: span2,
    timer: val1,
    pop: val2,
    bar: barFill,
    val: val3,
    dnaDrop: dnaVal1,
    dnaSpeed: dnaVal2,
    dnaBias: dnaVal3,
    dnaJump: dnaVal4,
    dnaMass: dnaVal5,
    bestFit: val4,
    popInput,
    food: foodInput,
    speedBtn,
    log: logConsole,
    uiLayer,
    toggleBtn,
    genomeChart: chartCanvas,
    immortalBtn,
  };

  return { ui: uiRefs, canvas };
}
