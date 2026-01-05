import type { UIRefs } from '../types';

interface UiHandlers {
  onSpeedChange: () => number;
  onPopulationChange: (value: number) => void;
  onFlyRateChange: (value: number) => void;
  onTogglePanel: (visible: boolean) => void;
  onImmortalToggle: () => boolean;
}

export function bindUI(ui: UIRefs, handlers: UiHandlers): void {
  ui.speedBtn.addEventListener('click', () => {
    const speed = handlers.onSpeedChange();
    ui.speedBtn.textContent = `Speed: ${speed}x`;
  });

  ui.popInput.addEventListener('input', (event) => {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    handlers.onPopulationChange(value);
  });

  ui.food.addEventListener('input', (event) => {
    const value = parseFloat((event.target as HTMLInputElement).value) / 200;
    handlers.onFlyRateChange(value);
  });

  ui.toggleBtn.addEventListener('click', () => {
    const willShow = ui.uiLayer.style.opacity === '0';
    ui.uiLayer.style.opacity = willShow ? '1' : '0';
    handlers.onTogglePanel(willShow);
  });

  ui.immortalBtn.addEventListener('click', () => {
    const on = handlers.onImmortalToggle();
    ui.immortalBtn.textContent = on ? 'Immortal: On' : 'Immortal: Off';
  });
}
