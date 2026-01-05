import type { UiStats } from './types';

interface LoopOptions {
  getSimSpeed: () => number;
  update: (dt: number) => UiStats;
  render: () => void;
}

export function startLoop({ getSimSpeed, update, render }: LoopOptions): void {
  const stepCounts = [
    { speed: 10000, steps: 100 },
    { speed: 1000, steps: 50 },
    { speed: 100, steps: 20 },
    { speed: 10, steps: 5 },
  ];

  const frame = () => {
    const simSpeed = getSimSpeed();
    let steps = 1;
    for (const entry of stepCounts) {
      if (simSpeed >= entry.speed) {
        steps = entry.steps;
        break;
      }
    }

    const dt = (16 * simSpeed) / steps;
    for (let i = 0; i < steps; i++) {
      update(dt);
    }

    render();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
