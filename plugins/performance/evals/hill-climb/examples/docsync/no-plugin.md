---
fail: [waits, assumed-ceiling, assumed-fast-signal, assumed-guard, assumed-side-effects, assumed-scope, assumed-inputs, assumed-budget, assumed-parallelism]
---
I wrote the plan to `bench/CLIMB.md`, with a Rules section and a Checkpoint section. I built and ran nothing, so there are no measurements yet. The `/performance:hill-climb` command isn't installed in this session, so I did the task by hand from your arguments.

- **The harness doesn't test the real work.** The fixture lock already matches the manifest, so `docsync sync` prints "up to date with 4.2.0" and exits after resolve. It never runs fetch, apply, relink or index, so the README's 412 ms covers only a manifest parse and a lock read. A real sync would also overwrite the fixture lock, so later runs would all be no-ops.
- **Startup is a small part of the run.** The CI log from the 4.2.0 release shows a 133.6 s sync:

  | Phase | Time | Share |
  |---|---|---|
  | fetch | 71.8 s | 54% |
  | apply (relink 41.1 s of it) | 57.9 s | 43% |
  | index | 3.3 s | 2.5% |
  | resolve | 0.6 s | under 1% |

  I treated "startup" as "make `docsync sync` faster".
- **The plan:**
  1. Build a deterministic synthetic fixture of about 38 packages and 6,200 pages. Archives are pre-seeded in a temp cache under a temp `HOME`, so fetch runs offline, and each run starts from an empty lock and a fresh tree.
  2. Rewrite `bench.sh` to use that fixture, and keep the existing no-op case as a second benchmark.
  3. Record a baseline with a tree hash that every candidate must match.
  4. Try these candidates, one at a time:
     - relink: skip unchanged files.
     - relink: parallelize the rewrite pass.
     - apply: run packages in parallel.
     - apply: cut syscalls per page.
     - index: build it during apply.
     - fetch: download concurrently.
- **Fetch can't be measured offline.** It is over half of the real run, and an offline harness can't see download time. Concurrent fetch would need separate verification, for example against a local HTTP server.
