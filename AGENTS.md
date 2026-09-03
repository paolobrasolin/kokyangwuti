# AGENTS.md

You are an expert in JavaScript, Rsbuild, and web application development. You write maintainable, performant, and accessible code.

## Commands

- `npm run dev` - Start the dev server
- `npm run build` - Build the app for production
- `npm run preview` - Preview the production build locally
- `npm run test` - Fast test suite; `npm run test:slow` for the statistical
  selection tests (whole generations, ~30 s)
- `npm run bench` - Headless throughput and golden-checksum benchmarks
- `npm run headless -- --generations N --pop P` - Run generations in Node;
  `--seeds a,b,c` or `--seeds N` runs several seeds in parallel worker threads

## Invariants

- Speed never enters `src/simulation` or `src/physics`. The engine steps the
  world by `TICK_MS` and only varies how many ticks run per second.
- Optimisations that claim to be pure refactors must leave the checksums from
  `bench/golden.bench.ts` unchanged.

## Docs

- Rsbuild: https://rsbuild.rs/llms.txt
- Rspack: https://rspack.rs/llms.txt

- Rstest: https://rstest.rs/llms.txt

## Tools

### Rstest

- Run `npm run test` to run tests
- Run `npm run test:watch` to run tests in watch mode

### Biome

- Run `npm run check` to lint and auto-fix your code
- Run `npm run format` to format your code
