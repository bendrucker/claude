---
name: performance:benchmark
description: >-
  Use when timing a program or command, asking whether a change or version
  made it faster, or building a benchmark harness. For repeated optimization
  toward a target, use performance:hill-climb.
argument-hint: "[<command>]"
---

# Benchmark

Goal: a comparison the user can trust. Every arm runs the same scenario from the same starting state, the arms are interleaved so machine drift hits them equally, the noise floor is measured before any difference is read, and a difference counts only when it clears that floor.

## Tools

- `hyperfine`: !`hyperfine --version 2>/dev/null || echo "not found. Required unless the project's own tooling covers its job."`
- `bun` (runs `compare.ts`): !`bun --version 2>/dev/null || echo "not found. Required for compare.ts."`

## Existing Tooling

Look for the project's own benchmarks before building one: package scripts, a `bench/` directory, benchmark tests, CI jobs that time something. Check each against the requirements the setup below is built to meet:

- **Scenario.** It runs the scenario the user cares about, from the same starting state every run.
- **Isolation.** Network, remote state, and caches are stubbed, held fixed, or reset per run.
- **Interleaving.** Arms alternate within one run or one process, so drift hits every arm.
- **Samples.** It keeps every run's measurement, enough of them to show an A/A noise floor, not only a mean.
- **Significance.** It reports a significance test, or its samples can feed `compare.ts report`.

Use the existing tooling when it meets every requirement. When it misses some, compose around it and keep its scenario: run its command as a `compare.ts` arm for interleaving and significance, or add a `--prepare` reset. Tell the user which requirement it missed and what you added.

## Scenario

Pin the scenario before timing it. A run that changes its own input measures a different scenario each time.

- Reset state per run with `--prepare` (restore a fixture, clear or warm a cache), and one-time setup with `--setup`. Match the cache state to the scenario the user cares about. A cold-start metric needs a cold cache on every run.
- Stub or hold fixed everything outside the program: network, remote state, other processes' files. When the program syncs with a remote, point it at a local copy that stays unchanged.
- Pass `-N` when the command is a single executable with arguments, which removes the shell's startup from every sample.
- Check the machine before a baseline: on AC power, idle (`uptime` load near zero), no power-saving mode. Record the load beside the baseline.
- For a shell script or shell startup (`.zshrc`, `.bashrc`), read [references/shell.md](references/shell.md).

## Arms

Build every arm so it exists on disk at once: a `git worktree add <dir> <ref>` per version, or a separate build output per arm. Put each worktree outside the repo, since a test runner, linter, or watcher walking the tree picks up a nested checkout as part of the program. Interleaving needs both arms runnable in the same round, so switching branches between runs is out.

Compare with the bundled script, which runs short `hyperfine` rounds in rotating order and pools them:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/compare.ts run tmp/bench/<comparison> \
  --arm 'base=<command>' --arm 'candidate=<command>' --rounds 6 --runs 3 -- -N --prepare '<reset>'
bun ${CLAUDE_SKILL_DIR}/scripts/compare.ts report tmp/bench/<comparison> --markdown
```

The first `--arm` is the base. Arguments after `--` go to every `hyperfine` call. Give each comparison its own directory, since `run` refuses one that already holds exports. `report` also reads `--export-json` files from a plain `hyperfine` run, and pools every file and directory it is given per arm name.

## Noise Floor

Before comparing versions, run the unchanged program as two arms (an A/A comparison). The pair must come back as a tie. When it stars, the harness is noisier than the effect it would measure: raise `--runs` or `--rounds`, quiet the machine, or find the state that leaks between runs, then repeat until the pair ties. The A/A spread (`±MAD`) is the smallest change the harness can resolve.

When the Mac's A/A will not tie or the fast signal needs `perf` or hardware counters, read [../profile/references/linux-vm.md](../profile/references/linux-vm.md).

## Reading the Report

- `*` marks a change with permutation p below `--alpha` (0.1) and a size of at least `--min-effect` (3%). An unstarred change is a tie, however large it looks.
- `†` marks fewer than 4 runs on a side, too few to star.
- A nonzero `failed` count means some runs exited nonzero and left the pool. Find out why before reading the row.
- About one comparison in ten stars by chance at the default alpha. Re-run a star on a metric nobody predicted would move before treating it as a result.

## Fast Signals

Wall time is the metric users feel, and the noisiest. A fast signal screens candidates cheaply and confirms with lower noise. Before trusting one, check on the baseline that it moves with wall time.

- **CPU and counters.** `perf stat` on Linux and `/usr/bin/time -l` on macOS report instructions retired, cycles, and peak memory. Instructions retired vary far less than wall time. `time -l` counts the top process only, not its children, and reads a sysctl the Bash sandbox denies.
- **Microbenchmarks.** When a candidate changes one hot function, benchmark that function in-process. [references/javascript.md](references/javascript.md) covers TypeScript on Bun and Node. [references/go.md](references/go.md) covers `testing` benchmarks and `benchstat`. [references/rust.md](references/rust.md) covers `criterion`, `divan`, and instruction counts. [references/python.md](references/python.md) covers `pytest-benchmark`.
- **Work counts.** Deterministic counts (renders, queries, syscalls, bytes written) have no noise. Count them wherever the program exposes them.

## Gotchas

- `hyperfine` runs each command's runs back to back. Two separate `hyperfine` invocations minutes apart carry drift between them, so compare arms inside one interleaved run.
- A benchmark built from a debug or profiling build measures that build. Check the build flags against what users run.
- Few rounds produce differences that flip sign on a re-run. When a result surprises, re-run it at more rounds before acting on it.
- Synthetic inputs whose shape differs from real ones (size, cardinality, nesting) can invert a conclusion. Confirm on real inputs.
