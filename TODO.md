# TODO

## The original arc

- [x] scrape SOTA abt arachnids' biomechanics and silk weaving
- [x] feed everything into big belly robot
- [x] extract minimal principles to found simulation
- [x] synthesis of minimal principles to feed into small belly robot that writes code

`harmer2010.md` holds the biomechanics reading; `PLAN.md` is what came out of the
synthesis and is still the authority on what may exist in the simulation layer.

## Done (the PLAN.md rescue, phases 1-5)

- [x] **Determinism.** `src/rng.ts`: splittable mulberry32 streams, forked by
      `hash(seed, label)`. One stream per concern — prey, per-agent behaviour,
      selection, world generation — all derived from a single root seed. No
      module-level mutable state anywhere in the simulation or physics layers.
- [x] **Emergent construction.** The explore→radial→spiral state machine is
      gone. Fifteen rule parameters (thresholds, biases, gains, probabilities)
      drive a sensorimotor loop over strictly local senses. Radial count, spiral
      spacing and hub position are consequences, not fields.
- [x] **Physical capture.** Flies couple into the web as massive nodes and the
      solver resolves the impact; `resolveImpact` and `computeSupportCapacity`
      are gone. Silk damping and adhesion do the work, and broken silk stays
      broken.
- [x] **Population EA.** Persistent population, elitism 2, tournament k=3,
      uniform crossover, clamped jitter mutation — all pure and seeded.
- [x] **Fast-forward actually simulates.** A long tick is split into substeps of
      at most `MAX_SUBSTEP_DT`, so the construction rules cannot be stepped over
      at simSpeed 100/1000 (they were: the population built literally nothing).
- [x] **Fitness is causal and comparable.** Energy is scored as a delta from
      birth, closing the body-mass loophole; reported and recorded fitness is
      normalised by the prey the generation offered.
- [x] **Speed is scheduling, not simulation.** The engine (`src/engine/`)
      always steps the world by `TICK_MS`; speed only sets how many ticks run
      per wall-clock second, and Max runs as many as the CPU allows. The
      solver-off fast path and the reduced-iteration branch are gone, so a run
      is bit-identical at every speed. The simulation lives in a Web Worker and
      keeps its pace while the tab is hidden; the page draws packed frames.
- [x] **Thread queries are local.** A uniform grid over the springs
      (`src/physics/grid.ts`) answers fly sweeps, dragline casts and leg-sweep
      senses with exactly the candidates a full scan would return, in the same
      order. Together with node refs cached on springs this took a generation
      at population 8 from ~5 s to ~2 s with unchanged golden checksums
      (`bench/golden.bench.ts`).
- [x] Tests: 230 in the fast suite across rng, geometry, solver, world, senses,
      construction, capture, evolution, long ticks, engine, render frames and
      an entry-point boot smoke test; 6 statistical selection tests in
      `npm run test:slow`.

## Next

### Simulation

- [ ] **Give `bodyMass` an upside.** Right now it is pure cost — faster baseline
      drain, dearer crawling, dearer draglines, and nothing in return, so
      selection can only push it down. Candidates with a real biomechanical
      story: heavier spiders subdue larger prey (mass ratio gates capture), or
      body mass sets the silk cross-section a spider can pay out, and therefore
      thread strength.
- [ ] **Break the prey ceiling.** Eight webs blanket the arena and eat ~91% of
      the flies whatever they look like, so *mean* fitness is pinned by supply
      and only the best/mean split carries information. Normalisation makes the
      numbers comparable; it does not make the mean informative. Wants a real
      answer: per-agent arenas evaluated against the same prey stream, or a
      larger arena with sparser spider placement.
- [ ] **Fitness noise.** Identical genomes in one arena still score with a CV
      near 30%, mostly from where a spider happens to start. Longer generations
      or averaging a genome over several arenas would sharpen selection; both
      cost wall-clock time. Stratifying start positions into one band per agent
      was tried and measured *worse* on every axis (noise, discrimination,
      head-to-head), so it is not simply a sampling problem.
- [ ] **`evolution.bestGenome` is the luckiest draw, not the best genome.** It
      is the single highest-scoring individual ever seen, and with fitness this
      noisy that is often an ordinary genome that drew a good arena. The elites
      of the final population have survived repeated selection and are a better
      answer to "what did this run learn"; the UI shows the outlier.
- [ ] Silk should cost what it is worth: `costDropPixel` is flat, so a spider
      pays the same per pixel for gossamer capture silk and for structural
      radial. Price it by the silk profile.
- [ ] Multiple prey species (mass/speed classes) so `attachReach` and
      `captureSwitchThreshold` face a spectrum rather than one uniform fly.

### Presentation

- [ ] The genome chart plots 8 of 15 fields with no legend and no axis labels.
- [ ] Nothing in the UI shows *why* a web won — no capture-area overlay, no
      per-thread capture counts, no way to inspect a single spider.
- [ ] The fitness history (`evolution.fitnessHistory`) is recorded and never
      drawn.

### Performance

Measured on 2026-09-03 (one laptop core, 1280×720): ~50x real time at
population 8, ~16x at population 24, with the solver at ~70% of a tick. That
is the single-thread ceiling for *exact* physics. Every layout change that
keeps the arithmetic identical was prototyped on a real end-of-generation
world, checked bit-for-bit, and timed — none paid:

- struct-of-arrays (typed arrays for positions, indices for springs): flat,
  slightly slower (0.30 vs 0.27 ms per step);
- mass ratios and half-stiffness precomputed per spring: flat;
- interleaving independent connected components in the relaxation order (exact,
  since webs only meet at pinned nodes): flat on mature webs, ~25% early on;
- the same kernel in WebAssembly (clang, no FMA, bit-identical): 1.35x on the
  kernel, 1.15x after copying positions in and out — not worth a toolchain.

The loop is bound by the sqrt/divide chain per spring, not by memory layout.
What is left changes the arithmetic or the design:

- [x] Parallel *runs*: `npm run headless -- --seeds N` runs N seeds in N
      worker threads, N× aggregate throughput with no change to any run
      (`bench/run.ts`, `bench/headless.ts`). The page still runs one seed.
- [ ] Per-agent arenas (see "Break the prey ceiling") would make one run's
      agents independent and parallel too — a design change, not a refactor.
- [ ] Fewer relaxation iterations or reciprocal-multiply normalisation would
      be faster but are a *different* simulation; only with a new golden
      baseline and a deliberate decision.

### Housekeeping

- [ ] `AGENTS.md` still lacks `npm run test` in its Commands section.
- [ ] No CI runs the suite.
