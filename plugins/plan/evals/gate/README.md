# Plan Gate Corpus

Mines every recorded `ExitPlanMode` presentation so `hooks/replay.test.ts` can show what a rule change in `hooks/gate.ts` would have decided on each one, without waiting weeks for new sessions.

A **case** is one recorded presentation, identified by the session's eight-character prefix and its sequence in that session (`60d87ed2-seq2`).

## Privacy

`mine.ts` pulls every presentation from the session index, work host included, because the replay needs each session's full history to reproduce state-dependent rules. `data/` is gitignored and never lands in this public repo.

## Workflow

`mine.ts` shells out to the `duckdb` CLI and reads the session index the `observability:session` skill maintains. Refresh that index through the skill first if it is stale.

From the repo root:

```bash
bun run --cwd plugins/plan/evals/gate mine  # session index -> data/presents.json
bun test plugins/plan/hooks/replay.test.ts
```

`mine` takes `--db` for another index path and `--since` for an earlier start date.

## Replay

The `mined corpus` test in `hooks/replay.test.ts` runs only when `data/presents.json` exists. It feeds each session's presentations through `processInput` in order, against a temporary state root, and prints a tally of the recorded outcome (`actual`) against the gate's decision now (`replay`). The tally keeps only rows where either side names a gate rule. `actual` comes from `classifyResponse` in `hooks/decisions.ts`, and `unknown` is a tool result it did not recognize.

The first run saves every decision to `data/replay.json`. Later runs fail on each case whose decision moved against that baseline. To test a rule change, run the test before editing `hooks/gate.ts`, edit, and run it again. Delete `data/replay.json` to accept the new decisions.

Two era differences show up between `actual` and `replay` and are not regressions:

- Presentations from before the 10k threshold (#1293, 2026-08-28) show as `user:rejected` with a `gate:size` replay when a second oversized presentation passed the 12k-era gate.
- Presentations the retired growth rule denied (removed 2026-09-11) show as `gate:growth` with a `gate:size` or `none` replay.
