# Screen

A screen runs a candidate on its target and guard cases only, with many repeats in one invocation, to decide whether the candidate earns a full-suite verify. Power on a case comes from that case's run count. A full replicate spends most of its cost on cases the candidate never touches. A screen reaches the same per-case power in a fraction of the time.

## Repeats

At a base that passed all its runs on a case, the cell stars at p<0.1 only once the candidate fails about 5 runs, at any run count. Run about 5 ÷ the drop rate repeats a side:

| Drop on one case | Repeats a side | Example |
| --- | --- | --- |
| all runs | 4 | 4/4 → 0/4, p=0.03 |
| half | 8 to 10 | 8/8 → 4/8, p=0.08 |
| a quarter | 16 to 20 | 16/16 → 12/16, p=0.10. 20/20 → 15/20, p=0.05 |

A base one run below ceiling needs about two more failures to star. Raising alpha to 0.2 saves at most one failure at a ceiling base. Size a prune screen the same way. Size every screen from the smallest drop that would reject the candidate, since a smaller screen passes that regression.

## Invocations

Repeats inside one invocation share its drift: fixture setup, cache warmth, and the backend's state at that moment. A screen accepts that drift because its base side runs at the same moment and shares it. Run the two sides concurrently, or back to back, on the same harness version and model.

A screen's repeats are less independent than replicates. Its p-values overstate confidence. A screen therefore decides only whether a candidate goes to verify, and never accepts. The verify columns pool separate invocations, where drift varies inside each column rather than between them.

When cases mutate fixture state seeded once per invocation, repeats are not independent at all. Reset the fixture per repeat or screen with separate invocations.

## Parallelism

Use the harness's parallel workers inside each invocation. The slowest case and fixture setup bound wall time, and total agent time ÷ workers is the floor. Screens of several candidates can run at once, each beside its own base side or sharing one base side launched at the same moment.

For verify, run the base and candidate sides of each replicate concurrently, and run the replicates one after another. Each pair then sees the same backend moment. Time drift lands on both columns instead of between them, and the pooled column still spans drift across pairs. Launching every replicate of both sides at once collapses them into one time slice, which is no better than in-invocation repeats.

Concurrency adds its own failure modes:

- Rate limits and timeouts error runs unevenly between sides. An errored run is void, per `Compare`.
- Fixtures sharing a port, a database, or a working directory collide across invocations. Give each invocation its own.
- Latency and cost rise under load. Compare them only between runs at the same concurrency.
- The native runner names a result directory by the second plus `--ref` or `--label`. Give concurrent runs distinct labels.

## When to Skip

Skip the screen when the target and guard cases make up most of the suite, since the screen then costs as much as the verify. Skip it for a reach candidate whose guards are the quiet cases across the suite.
