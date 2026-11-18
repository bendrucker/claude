# Perf and Concurrency Lens

Find what the plan breaks or slows on a hot path, in I/O, or under concurrency.

Read the plan, then the code paths it changes. Check:

- Work added to a path that runs per request, per event, per file, or per keystroke. Estimate the cost from the code and cite it.
- Blocking I/O, unbounded reads, N+1 queries, or a synchronous call where the caller waits.
- Shared state written from more than one process, thread, or session: locks, temp files, caches, markers. Name the race and the interleaving that triggers it.
- Timeouts, retries, and cancellation: what happens when the slow path is killed partway.

Report up to five findings, each with the path, the failure or cost, the evidence, and the change to the plan. Report "clear" when none apply.
