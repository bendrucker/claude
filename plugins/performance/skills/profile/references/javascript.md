# JavaScript and TypeScript

The runtime's own profiler names JavaScript functions with source locations. `samply` shows the same code as JIT addresses, so use it only for native time and child processes.

## Bun

```bash
bun --cpu-prof-md --cpu-prof-dir tmp/profile <script.ts> [args]
```

`--cpu-prof-md` writes the profile as markdown built for reading in a model's context: hot functions with self and total time and their source locations. Read that file directly.

- `--cpu-prof` writes a `.cpuprofile` for Chrome DevTools or `speedscope`. Keep one beside the markdown for the user.
- `--cpu-prof-interval <µs>` samples more often for a short script.
- `--heap-prof` records allocations when the question is memory.
- The profile covers one Bun process. A script that spawns Bun children needs the flag passed to each, or `samply` over the whole tree.

## Node

```bash
node --cpu-prof --cpu-prof-dir tmp/profile <script.js> [args]
```

This writes a `.cpuprofile` JSON. Summarize it by aggregating `nodes[].callFrame` self time weighted by `samples` and `timeDeltas`, or hand it to `speedscope` for the user. `--heap-prof` covers allocations.

For TypeScript on Node, profile the form users run. A loader such as `tsx` shows up as its own startup cost.

## Startup and Imports

A short CLI often spends most of its time before `main` runs: transpiling, resolving, and evaluating imports.

- Compare `bun -e ''` (or `node -e ''`) with the full run to see the runtime's floor.
- Rank imports by timing an entry that only imports each top-level dependency.
- A `bun build --compile` binary skips transpile at startup. Profile that form when users run it.

## Waiting

When the CPU profile covers a small share of wall time, the script is waiting on `await`s: subprocesses, network, disk. The CPU profile does not show that time.

- Run `samply` over the whole command to see child processes and their wall spans ([samply.md](samply.md)).
- Time each `await` boundary with `performance.now()` around the phases, and log one line per phase to stderr. Run it once and rank the phases.
- Sequential awaits over independent work show up as phases whose wall times add up. That points at a candidate to run in parallel.
