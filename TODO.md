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
- [x] Tests: 198 across rng, geometry, solver, world, senses, construction,
      capture, evolution, fast-forward and an entry-point boot smoke test.

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
- [ ] Speed 10000 degrades construction fidelity to keep the frame alive; the UI
      does not say so.

### Housekeeping

- [ ] `AGENTS.md` still lacks `npm run test` in its Commands section.
- [ ] No CI runs the suite.
