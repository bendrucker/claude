# samply

`samply` samples any native process and every child it spawns, without root and without instrumenting the program. It answers both questions a slow command raises: which process holds the time, and which functions inside it.

## Record

```bash
samply record --save-only --unstable-presymbolicate -o tmp/profile/<name>.json.gz -- <command>
```

- `--save-only` writes the profile without opening the browser UI.
- `--unstable-presymbolicate` writes a `.syms.json` sidecar beside the profile, which the summary script needs for function names.
- `--rate <hz>` raises the sampling rate (default 1000) for a short command.
- `--iteration-count <n>` repeats the command into one profile, which fills in a command that runs for well under a second.

## Summarize

Run the bundled script for a ranking:

```bash
bun <skill-dir>/scripts/samply-top.ts tmp/profile/<name>.json.gz --json
```

It reports each process (start offset, wall, CPU, threads), then the top functions by self and inclusive CPU time with their share, each labeled with its library or executable. `--json` prints it as compact JSON, a sixth the size of the default box tables. Drop the flag when showing the output to the user as is.

- `--process <name|pid>` limits the rankings to one process.
- `--wall` weights main-thread samples by wall time, which ranks where a waiting program blocks: `read`, `waitpid`, `kevent`, and the callers above them.
- The process table alone often answers a waiting program: the child with the longest wall span, or a run of short children that each pay startup.

Point the user at `samply load tmp/profile/<name>.json.gz` for the full call tree and timeline in the Firefox Profiler.

## Reading It

- Inclusive rankings start with entry points (`start`, `main`) near 100%. Read down to the first frame that belongs to the program's own logic.
- Many short processes with similar names (`git`, `rustup`, `node`) usually mean startup cost repeated per spawn. Count them and multiply before chasing any one function.
- A process named for one tool whose frames belong to another is a shim or wrapper (mise, asdf, rbenv). Its cost is paid on every call through it. Resolve the real binary path once to skip it.
- JIT-compiled JavaScript shows up as unnamed addresses in `samply`. Use the runtime's own profiler for those frames ([javascript.md](javascript.md)).

## Gotchas

- `samply` cannot attach to SIP-protected binaries (`/bin/sh`, `/bin/bash`, `/usr/bin/*`) and fails with "Could not obtain the root task". On macOS, start the command through an interpreter outside `/bin` and `/usr/bin`. Children that are SIP binaries go missing from the profile without an error.
- Record against the same scenario and state the benchmark uses. A first run that fills a cache profiles the cache fill.
