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
src/physics/           Verlet mass-spring world: nodes, springs, threads, solver
src/simulation/        senses, construction rules, prey, evolution, lifecycle
src/render/            canvas drawing
src/ui/                DOM panel construction, bindings, presenter
```

`PLAN.md` is the design document and the authority on what may and may not exist
in the simulation layer. `AGENTS.md` has the working conventions.

## Development

```bash
npm install
npm run dev      # dev server with hot reload
npm run build    # production bundle into dist/
npm run preview  # serve the production build
npm run test     # rstest suite (jsdom)
npm run check    # biome lint + format, writing fixes
```

The on-screen controls set simulation speed, population size and prey rate, and
toggle immortality (useful for watching construction without the energy clock).
At speed 1000 and above the physics solver is switched off and prey is resolved
by a documented approximation; construction itself still runs at full fidelity,
because a long tick is internally split into substeps short enough that no
sensorimotor rule can be stepped over.
