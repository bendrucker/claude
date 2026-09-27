# JavaScript and TypeScript

## Whole Programs

Benchmark a CLI or script through `hyperfine` like any other command. Decide what startup the scenario includes:

- `bun script.ts` transpiles on every start. A CLI users run as a bundled or compiled binary (`bun build --compile`, `bun build --target=bun`) is measured in that form.
- `node --import tsx script.ts` and similar loaders add their own startup. Measure the form users run.
- Separate startup from work when the climb targets one of them: time `bun -e ''` or an import-only entry alongside the full run.

## Microbenchmarks

Use [`mitata`](https://github.com/evanwashere/mitata) to benchmark a function in-process. It runs on Bun and Node, handles warmup and JIT tiering, and reports percentiles.

```ts
import { bench, do_not_optimize, run } from "mitata";

bench("base", () => do_not_optimize(baseImpl(input)));
bench("candidate", () => do_not_optimize(candidateImpl(input)));
await run();
```

- Pass every result through `do_not_optimize`. The JIT removes a call whose result is unused, and the benchmark then times an empty loop.
- Build `input` outside the benchmark body, from real data where possible. A tiny or uniform input hits paths real inputs never take.
- Put both implementations in one file so they share a process and interleave. Comparing two separate runs reintroduces drift.
- Treat a microbenchmark win as a screen. Confirm it on the whole program, since a faster function on a cold path leaves the user-facing metric unchanged.
