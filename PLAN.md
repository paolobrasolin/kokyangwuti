# The Path Back: from scripted blueprint to rule-based emergence

> **Status:** phases 1-5 implemented; see TODO.md for what is done and what is next.

## Why

Commit 34d6456 hardcoded an explore→radial→spiral state machine; the genome now
tunes knobs on a fixed orb blueprint (`radialCount`, `spiralSpacing`, `hubSize`).
This answers by fiat the question the project exists to ask: *what web
architectures emerge from minimal local principles?* (see TODO.md, harmer2010.md).

The rescue: spiders sense only **local** state and the genome encodes **rules**
(thresholds, biases, switching conditions). Orb-like geometry must emerge — or
fail to — under selection. Reference lineage: Krink & Vollrath's rule-based orb
simulations; Gotts & Vollrath's NetSpinner; Harmer et al. 2010 for the
biomechanics of prey capture (energy absorption, adhesion).

Three pillars, in dependency order:

1. **Determinism** — seeded RNG everywhere. Without identical fly sequences and
   reproducible behavior, evolution measures luck, not genomes.
2. **Emergent construction** — delete the blueprint; replace with a sensorimotor
   loop whose parameters are the genome.
3. **Causal physics** — prey capture resolved by the mass-spring solver, not by
   the heuristic formula in `resolveImpact`. Silk properties and architecture
   must matter *mechanically*.

Plus: a real evolutionary algorithm (population selection, not
mutants-of-single-best), and tests for the pure logic.

## Non-negotiable design principles

- **No global blueprint state on the agent.** Forbidden: preset hub coordinates,
  `webRadius`, `currentAngle`, `radialsBuilt`, `spiralRadius`, `spiralAngle`,
  scripted phase counters. A "hub" may exist only as *discovered* memory (e.g.
  "the most-connected node I have visited"), never as a preset target like
  `state.width * 0.5`.
- **Senses are local.** The agent may know: geometry of threads at its current
  node/spring (directions, angular gaps), tension (strain) of the current spring,
  local silk density within a small sensing radius, gravity direction, silk type
  underfoot, own-vs-foreign silk, distance walked since last attachment, and its
  own remembered landmarks (discovered, not preset).
- **Actions are primitive.** Walk, choose thread at junction, start/end a
  dragline (attach), drop on dragline, switch active silk type, stop building.
- **The genome parameterizes rules, not shapes.** Every genome field must be a
  threshold, bias, gain, or probability in a sensor→action rule. If a field
  directly names a geometric feature of the finished web, it is blueprint and
  must not exist.
- **Interpretable rules, not a neural net.** Parameterized decision rules in the
  Krink–Vollrath tradition: debuggable, and true to "minimal principles".
- **All randomness flows through the seeded RNG** in simulation and physics
  code. `Math.random()` is allowed only for pure cosmetics in the render layer.

## Target architecture sketch (guidance, not gospel — refine while implementing)

### Sensorimotor loop
Each decision tick the agent computes a small sensor record and evaluates its
rules. Example rule set the genome parameterizes:

- **Gap-filling (radials emerge):** at a junction on own silk, measure angular
  gaps between incident threads. If the largest gap > `angleGapThreshold`
  (genome, ~0.2–1.5 rad), launch a dragline bisecting that gap (with noise
  scaled by `buildNoise`). Radial count ≈ 2π/threshold — emergent, not encoded.
- **Exploration/anchoring:** on frame/foreign structure, drop probability per
  tick `exploreDropRate` (genome); drop direction biased by `gravityBias` and
  `structureAttraction` (toward sensed silk density), not toward canvas center.
- **Mode switching (spiral emerges):** when the local largest gap falls below
  `captureSwitchThreshold`, switch to capture silk. While in capture mode,
  walking a structural thread: when perpendicular distance to the nearest
  existing capture thread exceeds `attachReach` (genome — the "leg span"),
  bridge to the adjacent structural thread. Spacing emerges from `attachReach`.
- **Junction choice:** score incident threads by `tensionPreference` (bias
  toward taut/slack), `ownSilkPreference`, `headingInertia`, plus rng noise.
- **Homing:** `hubAttraction` biases junction choice toward the agent's
  discovered most-connected node.
- **Termination:** stop building when local silk density > `stopDensity` or
  energy budget forces it.
- **Physical traits kept:** `speed`, `bodyMass`, `gravityScale`.

Bad genomes should produce tangles or sparse nets. That is the point; selection
does the rest.

### Physical capture
A fly is a projectile with mass and velocity. On crossing a spring: couple it to
the web (temporary massive node at impact point, or point-load via the existing
`applyForceToSpring`/`applyImpulse` machinery, whichever proves stable) and let
the solver run. Springs stretched past `maxExtension` break (web damage is real
and persists). Capture = fly kinetic energy dissipated below a threshold while
adhesion holds; escape = adhesion roll fails (per-tick probability scaled by
spring adhesion and current tension) before energy is dissipated. Delete
`resolveImpact`'s magic-number capacity formula and `computeSupportCapacity`.
Keep it cheap: the fly interacts with nearby springs only; cap coupled-sim
duration (~1–2 s of sim time).

### Evolution
- Persistent population of genomes (not mutants-of-best). Per generation:
  evaluate all, rank, select via tournament, elitism of 1–2, mutate; optional
  uniform crossover.
- Fitness: energy captured minus silk + metabolic costs (energy accounting
  already exists — keep it causal).
- Noise control: one fly-sequence RNG stream per generation shared across the
  arena, so all genomes face the same prey. Per-agent behavior streams seeded as
  `hash(generationSeed, agentId)`.
- Track and expose per-genome web metrics (silk length spent, capture-thread
  length, approximate capture area) for the UI and for future fitness shaping.

## Phases

**Phase 1 — Foundation.** `src/rng.ts` (mulberry32 or similar, splittable
streams); thread RNG through simulation + physics; `.gitignore` (`.claude/`,
`.pnpm-store/`, `devpod_ssh`, `node_modules/`, `dist/`); fix AGENTS.md's
nonexistent `npm run lint` → `npm run check`; unit tests for `geometry.ts`,
`physics/solver.ts`, `physics/world.ts` (split/subdivide/adjacency/cleanup).

**Phase 2 — Emergent construction.** Rewrite `Genome`, agent state, and the
construction logic in `src/simulation/update.ts` + `agents.ts` per the
principles above. Delete the phase state machine. Headless integration test:
fixed seed, N ticks, assert a connected web forms with no NaNs.

**Phase 3 — Physical capture.** Replace the fly-capture formula with
solver-coupled dynamics. Tests: a slow light fly is held by capture silk; a fast
heavy fly breaks through sparse silk; determinism under fixed seed.

**Phase 4 — Evolution.** Population-based selection as above; update UI
bindings/chart for the new genome. Determinism test: same seed ⇒ identical
generation outcomes.

**Phase 5 — Verification & tuning.** Run the real app; tune genome ranges and
silk/energy constants until generation-0 spiders reliably build *something* and
selection visibly improves webs across ~10 generations under a fixed seed.
`npm run test`, `npm run build`, `npm run check` all clean. Update TODO.md.

Each phase leaves the app runnable (`npm run dev`) and tests green.
