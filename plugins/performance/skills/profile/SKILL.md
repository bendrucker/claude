---
name: performance:profile
description: >-
  Use when asked why a program, script, or web page is slow or memory-heavy,
  or what dominates its runtime, before deciding what to change.
argument-hint: "<command | url>"
---

# Profile

Goal: a ranked, readable list of where the program's time goes on the scenario the user cares about, with each entry's share of the total. Every optimization decision rests on that list, so it must come from a measurement of the real scenario.

## Tools

- `samply`: !`samply --version 2>/dev/null || echo "not found. Required for native and whole-process profiles."`
- `hyperfine`: !`hyperfine --version 2>/dev/null || echo "not found. Needed for the wall/CPU split."`
- `bun`: !`bun --version 2>/dev/null || echo "not found."`
- `node`: !`node --version 2>/dev/null || echo "not found."`
- `agent-browser`: !`agent-browser --version 2>/dev/null || echo "not found. Required for web apps."`
- `py-spy`: !`py-spy --version 2>/dev/null || echo "not found. Needed only for Python."`

When a required tool is missing and the project's own tooling does not cover its job, tell the user which one, then stop.

## Existing Tooling

Look for the project's own profiling setup before recording one: profiling scripts, an environment variable that turns on a profiler, a formatter for profiler output. Use it when it meets the requirements the references below are built to meet:

- **Scenario.** It profiles the scenario and build the user runs.
- **Ranking.** It ranks entries by self and inclusive time with each one's share, or writes a file that a summarizer or viewer ranks.
- **Coverage.** It covers every process the scenario spawns, and time spent waiting when wall time exceeds CPU.

When it misses some, use it for what it covers and add a profiler from the references for the rest.

## Split Wall From CPU

Run the scenario once under `hyperfine --runs 3` and compare wall time with user plus system CPU.

- **CPU-bound** (CPU near wall): a sampling profiler finds the hot functions.
- **Waiting** (wall well above CPU): the time goes to network, disk, child processes, locks, or sleeps. Find what it waits on: which child process runs longest, which request is slow. A CPU profile of a waiting program ranks the wrong things.

## Pick the Profiler

Profile the same scenario the benchmark measures, from the same starting state. The references call bundled scripts under `<skill-dir>`, which is `${CLAUDE_SKILL_DIR}`. Read the reference for the program's platform:

- Any native executable, or a whole process tree: [references/samply.md](references/samply.md). It follows child processes, so it also answers which child a waiting program waits on.
- TypeScript or JavaScript on Bun or Node: [references/javascript.md](references/javascript.md).
- Go: [references/go.md](references/go.md).
- Rust: [references/rust.md](references/rust.md).
- A web app in a browser: [references/browser.md](references/browser.md).
- A shell script: [references/shell.md](references/shell.md).
- Python: [references/python.md](references/python.md).

When macOS blocks the profiler or the metric needs hardware counters, read [references/linux-vm.md](references/linux-vm.md).

## Report

Write the ranking as a table: entry (function, process, or phase), its time, and its share of the scenario's total. Name the tool and the scenario that produced it. Keep the raw profile file beside the table so the user can open it in its viewer.

A profile ranks candidates. It does not show that fixing one moves the metric. Hand the ranking to `performance:benchmark` or `performance:hill-climb` to measure a change.

## Gotchas

- A profiler adds overhead that falls unevenly across code. A per-command trace inflates many cheap commands far more than a few expensive ones. Use the profile to find candidates, then time each suspect alone without the profiler to rank and bound it.
- Compare the profile's total span with the metric. A span well short of the metric means the profile missed part of the scenario, such as a config file that never loaded.
- A profile of a debug build, a warm cache the real scenario lacks, or a tiny input ranks the wrong hot spots. Match the scenario.
- On macOS, profilers cannot attach to SIP-protected system binaries (`/bin/sh`, `/usr/bin/*`). Run the program through an interpreter or binary outside those directories, or move the run into a Linux VM ([references/linux-vm.md](references/linux-vm.md)).
