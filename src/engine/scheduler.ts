/**
 * Wall-clock pacing for a fixed-step simulation.
 *
 * The simulation only ever advances by whole ticks of `tickMs`. "Speed" is the
 * number of simulated milliseconds owed per wall-clock millisecond: at speed 5,
 * five ticks fall due every 80 ms of wall time. The scheduler keeps that debt,
 * pays it off in ticks whenever it is pumped, and says how long until the next
 * tick is due. It never changes the length of a tick, so the simulation is
 * bit-for-bit identical at every speed — speed only decides *when* ticks run,
 * never what happens inside one.
 *
 * Speed `Infinity` ("Max") means: keep ticking for the whole budget, every time.
 */

export interface SchedulerOptions {
  tickMs: number;
  /** Monotonic wall clock in ms. Injectable so tests can drive time by hand. */
  now?: () => number;
  /**
   * Never owe more than this much *wall* time worth of ticks. If the CPU
   * cannot keep up with the target speed the backlog would otherwise grow
   * without bound; with the cap the simulation simply runs at whatever speed
   * it can manage, and `measuredSpeed` says what that is.
   */
  maxBacklogMs?: number;
  /** Window over which `measuredSpeed` is averaged, wall ms. */
  measureWindowMs?: number;
}

export interface PumpResult {
  /** Ticks run by this pump. */
  ticks: number;
  /** Wall ms until the next tick is due; 0 means "there is more to do now". */
  nextDelayMs: number;
}

interface Sample {
  wall: number;
  sim: number;
}

export class TickScheduler {
  readonly tickMs: number;
  private readonly now: () => number;
  private readonly maxBacklogMs: number;
  private readonly measureWindowMs: number;

  private speed = 1;
  /** Simulated ms owed and not yet run. */
  private debt = 0;
  private lastWake: number | null = null;
  /** Simulated ms advanced since construction. */
  private simTotal = 0;
  private samples: Sample[] = [];

  constructor(options: SchedulerOptions) {
    this.tickMs = options.tickMs;
    this.now = options.now ?? (() => performance.now());
    this.maxBacklogMs = options.maxBacklogMs ?? 1000;
    this.measureWindowMs = options.measureWindowMs ?? 1000;
  }

  getSpeed(): number {
    return this.speed;
  }

  /** Set the target speed. `Infinity` runs flat out. */
  setSpeed(speed: number): void {
    if (!(speed > 0)) throw new RangeError(`speed must be > 0, got ${speed}`);
    this.speed = speed;
    // A change of pace must not turn into a burst of catch-up ticks: forget
    // whatever was owed and start pacing afresh from this moment.
    this.debt = 0;
    if (this.lastWake !== null) this.lastWake = this.now();
  }

  /**
   * Run every tick that has fallen due, stopping early once `budgetMs` of wall
   * time has been spent so the caller can yield to its event loop.
   */
  pump(tick: () => void, budgetMs: number): PumpResult {
    const start = this.now();
    const unbounded = !Number.isFinite(this.speed);

    if (!unbounded) {
      if (this.lastWake !== null) {
        this.debt += (start - this.lastWake) * this.speed;
      }
      const cap = this.maxBacklogMs * this.speed;
      if (this.debt > cap) this.debt = cap;
    }
    this.lastWake = start;

    const deadline = start + budgetMs;
    let ticks = 0;
    if (unbounded) {
      do {
        tick();
        ticks++;
      } while (this.now() < deadline);
    } else {
      while (this.debt >= this.tickMs) {
        tick();
        ticks++;
        this.debt -= this.tickMs;
        if (this.now() >= deadline) break;
      }
    }

    this.simTotal += ticks * this.tickMs;
    this.record(this.now(), this.simTotal);

    if (unbounded || this.debt >= this.tickMs) return { ticks, nextDelayMs: 0 };
    return { ticks, nextDelayMs: (this.tickMs - this.debt) / this.speed };
  }

  /** Simulated ms advanced so far. */
  totalSimMs(): number {
    return this.simTotal;
  }

  /**
   * Simulated ms per wall ms over the recent window, or null until there is
   * enough history to say. This is the honest speed, whatever the target is.
   */
  measuredSpeed(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const wall = last.wall - first.wall;
    if (wall < 50) return null;
    return (last.sim - first.sim) / wall;
  }

  private record(wall: number, sim: number): void {
    this.samples.push({ wall, sim });
    const cutoff = wall - this.measureWindowMs;
    // Keep one sample older than the window so the span covers the whole window.
    while (this.samples.length > 2 && this.samples[1].wall <= cutoff) {
      this.samples.shift();
    }
  }
}
