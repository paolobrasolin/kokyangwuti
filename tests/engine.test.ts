/**
 * The engine: fixed-step scheduling on a wall clock, and the worker host that
 * keeps a session ticking and answers the page.
 *
 * The property that matters most is pinned first: *speed is scheduling, not
 * simulation*. A run stepped one tick per wall-clock tick at speed 1 and a run
 * hammered through at Max must arrive at the identical world.
 */

import { describe, expect, test } from '@rstest/core';
import { TICK_MS } from '../src/config';
import { createWorkerHost, type HostTimers } from '../src/engine/host';
import type { WorkerToMain } from '../src/engine/protocol';
import { TickScheduler } from '../src/engine/scheduler';
import { createSession } from '../src/engine/session';
import type { SimulationState } from '../src/types';

/** A hand-cranked clock. Every `now()` call also moves time on by `perCall`. */
function fakeClock(perCall = 0) {
  let t = 0;
  return {
    now: () => {
      t += perCall;
      return t;
    },
    advance: (ms: number) => {
      t += ms;
    },
    time: () => t,
  };
}

/** Everything an observer could use to tell two worlds apart. */
function snapshot(state: SimulationState) {
  return {
    genTimer: state.genTimer,
    nodes: state.world.nodes.map((n) => [n.id, n.x, n.y]),
    springs: state.world.springs.map((s) => [s.id, s.nodeA, s.nodeB, s.broken]),
    agents: state.agents.map((a) => [
      a.id,
      a.x,
      a.y,
      a.energy,
      a.score,
      a.state,
    ]),
    flies: state.flies.map((f) => [f.id, f.x, f.y, f.nodeId]),
    spawned: state.fliesSpawned,
  };
}

describe('TickScheduler', () => {
  test('the first pump only starts the clock', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    let ticks = 0;
    const result = scheduler.pump(() => ticks++, 10);
    expect(ticks).toBe(0);
    expect(result.nextDelayMs).toBeCloseTo(TICK_MS, 6);
  });

  test('at speed 1 one tick falls due per TICK_MS of wall time', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    let ticks = 0;
    scheduler.pump(() => ticks++, 10);
    clock.advance(TICK_MS * 10);
    scheduler.pump(() => ticks++, 10);
    expect(ticks).toBe(10);
  });

  test('speed multiplies the ticks owed per wall millisecond', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    scheduler.setSpeed(5);
    let ticks = 0;
    scheduler.pump(() => ticks++, 10);
    clock.advance(160);
    scheduler.pump(() => ticks++, 10);
    expect(ticks).toBe(50);
  });

  test('a pump stops at its budget and asks to be called straight back', () => {
    // Each tick costs 1 ms of wall time here (one `now()` call per tick).
    const clock = fakeClock(1);
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    scheduler.setSpeed(100);
    let ticks = 0;
    scheduler.pump(() => ticks++, 10);
    clock.advance(160); // 1000 ticks owed
    const result = scheduler.pump(() => ticks++, 10);
    expect(ticks).toBeGreaterThan(5);
    expect(ticks).toBeLessThan(20);
    expect(result.nextDelayMs).toBe(0);
  });

  test('the backlog is capped, so a machine that cannot keep up does not spiral', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({
      tickMs: TICK_MS,
      now: clock.now,
      maxBacklogMs: 100,
    });
    scheduler.setSpeed(10);
    let ticks = 0;
    scheduler.pump(() => ticks++, 10);
    clock.advance(60000); // an hour's worth of ticks would be owed uncapped
    scheduler.pump(() => ticks++, 1000);
    // 100 wall ms at speed 10 = 1000 sim ms = 62.5 ticks.
    expect(ticks).toBe(62);
  });

  test('Max ticks for the whole budget, every time', () => {
    const clock = fakeClock(1);
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    scheduler.setSpeed(Number.POSITIVE_INFINITY);
    let ticks = 0;
    const result = scheduler.pump(() => ticks++, 24);
    expect(ticks).toBeGreaterThanOrEqual(23);
    expect(ticks).toBeLessThanOrEqual(25);
    expect(result.nextDelayMs).toBe(0);
  });

  test('changing speed does not release a burst of catch-up ticks', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    let ticks = 0;
    scheduler.pump(() => ticks++, 10);
    clock.advance(500);
    scheduler.setSpeed(20);
    scheduler.pump(() => ticks++, 10);
    expect(ticks).toBe(0);
  });

  test('measuredSpeed is simulated time over wall time', () => {
    const clock = fakeClock();
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: clock.now });
    scheduler.setSpeed(4);
    expect(scheduler.measuredSpeed()).toBeNull();
    scheduler.pump(() => {}, 10);
    for (let i = 0; i < 10; i++) {
      clock.advance(TICK_MS * 5);
      scheduler.pump(() => {}, 10);
    }
    expect(scheduler.measuredSpeed()).toBeCloseTo(4, 3);
  });

  test('a speed that is not positive is rejected', () => {
    const scheduler = new TickScheduler({ tickMs: TICK_MS, now: () => 0 });
    expect(() => scheduler.setSpeed(0)).toThrow(RangeError);
    expect(() => scheduler.setSpeed(Number.NaN)).toThrow(RangeError);
  });
});

describe('speed is scheduling, not simulation', () => {
  const TICKS = 600;

  function runAt(speed: number) {
    const clock = fakeClock(0.01);
    const session = createSession({
      width: 480,
      height: 320,
      seed: 7,
      log: () => {},
      now: clock.now,
    });
    session.setControls({ speed });
    // At a finite speed the first pump only starts the clock; at Max every
    // pump ticks, so there is nothing to prime.
    if (Number.isFinite(speed)) session.pump(0);
    for (let i = 0; i < TICKS; i++) {
      // One tick per pump either way: at a finite speed by letting exactly one
      // tick fall due, at Max by giving the pump no budget beyond its first tick.
      if (Number.isFinite(speed)) clock.advance(TICK_MS / speed);
      session.pump(0);
    }
    return session;
  }

  test('N ticks at speed 1 and N ticks at Max give the identical world', () => {
    const slow = runAt(1);
    const fast = runAt(Number.POSITIVE_INFINITY);
    expect(slow.scheduler.totalSimMs()).toBe(TICKS * TICK_MS);
    expect(fast.scheduler.totalSimMs()).toBe(TICKS * TICK_MS);
    expect(snapshot(fast.controller.getState())).toEqual(
      snapshot(slow.controller.getState()),
    );
  });

  test('N ticks at speed 100 give the same world too', () => {
    const slow = runAt(1);
    const hundred = runAt(100);
    expect(snapshot(hundred.controller.getState())).toEqual(
      snapshot(slow.controller.getState()),
    );
  });

  test('the run actually did something', () => {
    const state = runAt(1).controller.getState();
    expect(state.world.springs.length).toBeGreaterThan(0);
    expect(state.agents.some((a) => a.threadIds.length > 0)).toBe(true);
  });

  test('stats carry the target and the measured speed', () => {
    const session = runAt(20);
    const stats = session.stats();
    expect(stats.targetSpeed).toBe(20);
    expect(stats.measuredSpeed).not.toBeNull();
    expect(stats.measuredSpeed as number).toBeGreaterThan(10);
  });
});

// ========== HOST ==========

/** Timers driven by hand, with a clock that creeps forward on every read. */
function fakeTimers() {
  const clock = fakeClock(0.05);
  interface Task {
    at: number;
    fn: () => void;
    cancelled: boolean;
  }
  const tasks: Task[] = [];
  const timers: HostTimers = {
    now: clock.now,
    defer(fn) {
      const task = { at: clock.time(), fn, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    later(fn, ms) {
      const task = { at: clock.time() + ms, fn, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
  };
  /** Run every task due up to `until`, in order, then park the clock there. */
  function run(until: number): void {
    for (;;) {
      let next: Task | null = null;
      for (const task of tasks) {
        if (task.cancelled) continue;
        if (!next || task.at < next.at) next = task;
      }
      if (!next || next.at > until) break;
      tasks.splice(tasks.indexOf(next), 1);
      if (clock.time() < next.at) clock.advance(next.at - clock.time());
      next.fn();
    }
    if (clock.time() < until) clock.advance(until - clock.time());
  }
  return {
    timers,
    run,
    pending: () => tasks.filter((t) => !t.cancelled).length,
  };
}

function bootHost(speed = 1) {
  const posted: WorkerToMain[] = [];
  const transfers: ArrayBuffer[][] = [];
  const fake = fakeTimers();
  const host = createWorkerHost(
    (message, transfer) => {
      posted.push(message);
      transfers.push(transfer ?? []);
    },
    { timers: fake.timers, chunkMs: 24 },
  );
  host.onMessage({
    type: 'init',
    width: 480,
    height: 320,
    seed: 11,
    controls: { speed },
  });
  return { host, posted, transfers, ...fake };
}

describe('the worker host', () => {
  test('init answers ready and forwards the first log line', () => {
    const { posted } = bootHost();
    expect(posted.some((m) => m.type === 'ready')).toBe(true);
    const logs = posted.filter((m) => m.type === 'log');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toMatchObject({ message: 'Gen 1 Started' });
  });

  test('it keeps ticking on its own, whether or not anyone asks for frames', () => {
    const { host, run } = bootHost(1);
    run(400);
    const sim = host.session()?.scheduler.totalSimMs() ?? 0;
    expect(sim).toBeGreaterThanOrEqual(300);
    expect(sim).toBeLessThanOrEqual(420);
  });

  test('a frame request is answered with stats and a transferable picture', () => {
    const { host, posted, transfers, run } = bootHost(1);
    run(100);
    posted.length = 0;
    transfers.length = 0;
    host.onMessage({ type: 'frame', render: true });
    expect(posted).toHaveLength(1);
    const reply = posted[0];
    expect(reply.type).toBe('frame');
    if (reply.type !== 'frame') return;
    expect(reply.stats.generation).toBe(1);
    expect(reply.stats.targetSpeed).toBe(1);
    expect(reply.frame).not.toBeNull();
    expect(reply.frame?.segments.length).toBeGreaterThan(0);
    expect(transfers[0]).toHaveLength(6);
    expect(new Set(transfers[0]).size).toBe(6);
  });

  test('a stats-only request carries no picture and transfers nothing', () => {
    const { host, posted, transfers } = bootHost();
    posted.length = 0;
    host.onMessage({ type: 'frame', render: false });
    expect(posted[0]).toMatchObject({ type: 'frame', frame: null });
    expect(transfers[transfers.length - 1]).toHaveLength(0);
  });

  test('control changes reach the session', () => {
    const { host, posted } = bootHost();
    host.onMessage({
      type: 'controls',
      patch: { speed: Number.POSITIVE_INFINITY, population: 3, flyRate: 0.5 },
    });
    posted.length = 0;
    host.onMessage({ type: 'frame', render: false });
    expect(posted[0]).toMatchObject({
      type: 'frame',
      stats: {
        targetSpeed: Number.POSITIVE_INFINITY,
        targetPopulation: 3,
        flyRate: 0.5,
      },
    });
  });

  test('at Max the host uses its whole chunk and reschedules at once', () => {
    const { host, run } = bootHost(Number.POSITIVE_INFINITY);
    run(240);
    const sim = host.session()?.scheduler.totalSimMs() ?? 0;
    // The fake clock creeps 0.05 ms per read, so a 24 ms chunk is ~480 ticks
    // and 240 ms of wall time is ten chunks: far more than real time.
    expect(sim).toBeGreaterThan(240 * 10);
  });

  test('messages before init and after dispose are ignored', () => {
    const posted: WorkerToMain[] = [];
    const fake = fakeTimers();
    const host = createWorkerHost((m) => posted.push(m), {
      timers: fake.timers,
    });
    host.onMessage({ type: 'frame', render: true });
    expect(posted).toHaveLength(0);
    host.dispose();
    host.onMessage({ type: 'init', width: 10, height: 10 });
    expect(posted).toHaveLength(0);
    expect(fake.pending()).toBe(0);
  });
});
