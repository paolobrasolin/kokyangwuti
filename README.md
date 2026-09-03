# kokyangwuti

A browser artificial-life simulation, named for Kókyangwùuti — Spider Grandmother
— who in Hopi stories spins the world into being.

Spiders with rule-based genomes build webs on a mass-spring physics substrate,
catch physically-simulated flies, and evolve under a seeded population EA. It
runs entirely in the page: no server, no backend, no network.

## The thesis

**Web architecture is not designed. It falls out of local rules.**

The question the project exists to ask is *what web architectures emerge from
minimal local principles* — the Krink & Vollrath / NetSpinner lineage, plus
Harmer et al. 2010 for the biomechanics of prey capture. So the simulation is
built to make that question answerable rather than to produce pretty orbs:

- **The genome encodes rules, never shapes.** All fifteen fields are thresholds,
  biases, gains or probabilities inside a sensor→action rule. Nothing names a
  geometric feature of the finished web. Radial count, spiral spacing and hub
  position are *consequences* — radial count is roughly `2π / angleGapThreshold`,
  and it emerges, or fails to.
- **Senses are local.** A spider knows the directions of the threads at the
  junction it stands on, the angular gaps between them, the tension underfoot,
  the silk density within a leg sweep, its own silk from foreign silk, and the
  most-connected node it happens to have visited. There is no canvas-wide view
  and no preset hub.
- **Capture is physics, not a formula.** A fly is a ballistic particle; on impact
  the thread is split and the new node *is* the fly, at the fly's mass and
  velocity. From there the solver does the work — silk stretches, load
  propagates, springs past `maxExtension` break and stay broken. Capture is
  whatever falls out: the silk ate the fly's kinetic energy before the adhesion
  roll failed.
- **Everything is seeded.** One RNG stream per concern, all derived from a single
  root seed by `hash(seed, label)`. The prey sequence is its own stream, so every
  spider in a generation faces exactly the same flies and selection measures
  genomes rather than luck. Two runs of the same seed are identical, tick for
  tick. `Math.random()` is allowed only for cosmetics in the render layer.

Bad genomes produce tangles, or sparse nets, or nothing at all. That is the
point; selection does the rest.

## How a run works

One generation: instantiate the whole population as agents in a fresh arena
(canvas frame plus procedurally generated tree branches), run them for 60 s of
simulated time against a shared prey stream, then score, rank, and breed.
Breeding is deliberately plain — elitism of 2, tournament selection at k = 3,
uniform crossover, jittered mutation clamped to `GENOME_RANGES`.

Fitness is causal: the energy a spider *earned* over the generation (its balance
at the end, minus the ration it was born with) plus the value of the prey its web
took, with death penalised but its catches still counted. Reported and recorded
fitness is normalised by the number of flies the generation actually offered, so
"best of generation 3" and "best of generation 11" are comparable numbers.

## Layout

```
src/rng.ts             seeded, splittable RNG streams
src/geometry.ts        segment/intersection primitives
src/physics/           Verlet mass-spring world: nodes, springs, threads, solver,
                       and the spatial grid that keeps thread queries local
src/simulation/        senses, construction rules, prey, evolution, lifecycle
src/engine/            fixed-tick scheduler, worker host and page-side client
src/render/            packed render frames and canvas drawing
src/ui/                DOM panel construction, bindings, presenter
bench/                 headless throughput/golden benchmarks and a Node runner
```

`PLAN.md` is the design document and the authority on what may and may not exist
in the simulation layer. `AGENTS.md` has the working conventions.

## Development

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production bundle into dist/
npm run preview    # serve the production build
npm run test       # fast rstest suite (jsdom), a few seconds
npm run test:slow  # statistical selection tests: whole generations, ~30 s
npm run bench      # headless throughput + golden-checksum benchmarks
npm run headless -- --generations 20 --pop 8 --seed 1   # run generations in Node
npm run headless -- --generations 20 --seeds 1,2,3,4    # one run per worker thread
npm run check      # biome lint + format, writing fixes
```

The on-screen controls set simulation speed, population size and prey rate,
toggle immortality (useful for watching construction without the energy clock)
and switch the graphics off.

## Speed, threads and accuracy

The simulation advances in fixed 16 ms ticks, and nothing inside a tick knows
how fast the run is going. "Speed" is scheduling: how many ticks the engine runs
per wall-clock second — 1x, 5x, 20x, 100x, or Max, which is as many as the CPU
allows. Two runs of the same seed are identical tick for tick whatever speed
they were watched at (`tests/engine.test.ts` pins this). There is no cheaper
physics for fast-forward: the old 1000x path that switched the solver off and
resolved prey with an approximation is gone, so a long run is exactly the run
you would have watched at 1x.

The simulation runs in a Web Worker. The page only draws frames it is handed —
packed into typed arrays and transferred, so a frame costs the simulation
next to nothing — and asks for one per animation frame. A hidden tab, where
`requestAnimationFrame` stops, simply stops asking and the run carries on at
full pace in the background. The panel shows where the simulation is running
and the speed it is really achieving; the speed button shows the measured speed
in brackets whenever it falls short of the target. Where `Worker` is
unavailable the same host runs on the page thread instead.

Throughput on one laptop core at 1280×720: roughly 50x real time at population
8 and 16x at population 24, i.e. a 60 s generation in about 1.2 s. The solver
is ~70% of a tick and sits at the floor for exact physics (TODO.md records what
was tried); the thread queries (fly sweeps, dragline casts, leg-sweep senses) go
through a uniform grid that returns exactly the candidates a full scan would, in
the same order, so they changed nothing but the clock. `bench/golden.bench.ts`
prints checksums of a full generation for exactly this kind of claim: an
optimisation that is a pure refactor leaves them unchanged.
