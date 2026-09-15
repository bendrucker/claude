# Plan Gate Eval

Offline eval loop for the `plan` plugin's `ExitPlanMode` gate (`hooks/gate.ts`). It answers two questions without waiting weeks for new sessions: what a rule change would have decided on every past presentation, and how a model reworks a denied plan under one deny text versus another.

A **case** is one recorded presentation, identified by the session's eight-character prefix and its sequence in that session (`60d87ed2-seq2`). An **arm** is one deny text the rework runner hands a session, defined in `scripts/arms.ts`.

## Privacy

`mine.ts` pulls every presentation from the session index, work host included, because the replay needs each session's full history to reproduce state-dependent rules. `data/`, `results/`, and `workdir/` are gitignored and never land in this public repo. The rework runner hands plans to a model only when `host` is `local` (`selectCases` in `scripts/rework.ts`).

## Workflow

`mine.ts` shells out to the `duckdb` CLI and reads the session index the `claude-code:session` skill maintains. Refresh that index through the skill first if it is stale.

Then, from this directory:

```bash
bun run mine                                          # session index -> data/presents.json
bun run replay -- --save results/replay/current.json  # gate decisions on every presentation
bun run rework -- --arm current --run opus-current    # headless rework sessions, one arm
bun run rework -- --arm target --run opus-current     # a second arm into the same run
bun run report -- --run opus-current --cases          # per-arm summary and per-case table
```

Replay and rework both read `data/presents.json` and do not depend on each other. `mine` takes `--db` for another index path and `--since` for an earlier start date. `replay` and `rework` take `--presents` for another corpus, and `replay` takes `--host` to filter to one machine.

## Replay

`replay.ts` feeds each session's presentations through `processInput` in order, against a temporary state root, and prints a confusion table of the recorded outcome (`actual`) against the gate's decision now (`replay`). The table keeps only rows where either side names a gate rule. The rows it drops, an approval or a user rejection with a `replay` of `none`, are agreement: the gate passed the plan then and passes it now. An `actual` of `unknown` is a tool result the classifier in `decisions.ts` did not recognize.

To test a rule change, edit `hooks/gate.ts`, replay with `--against results/replay/current.json`, and read the per-case diff. Two era differences show up as disagreement and are not regressions:

- Presentations from before the 10k threshold (#1293, 2026-08-28) show as `user:rejected` with a `gate:size` replay when a second oversized presentation passed the 12k-era gate.
- Presentations the retired growth rule denied (removed 2026-09-11) show as `gate:growth` with a `gate:size` or `none` replay.

## Rework

`rework.ts` replays a size deny. It writes the denied plan into a scratch `plans/` directory under `workdir/`, runs `claude -p` with the planning guidelines appended to the system prompt, hands it the arm's deny reason, and records what the session did. The arms:

- `current`: the shipped `sizeReason` text.
- `target`: the measured character count, a target of about 8,000 characters, and a note that the limit counts characters rather than bytes.
- `count`: the count and the bytes note without a target.

Every metric is mechanical, read from the stream-json transcript and the files left behind:

- `tokens`: output tokens for the session.
- `wc`: Bash calls that invoke `wc`. Three or more counts as a whittle loop in the summary.
- `edits`: Edit calls in the session.
- `after`: final plan length in characters, with `over 10k` and `near 10k` (within 1,000) flags.
- `sidecar`: whether the session wrote a supporting file next to the plan.
- `del`: lines of the original plan that appear verbatim in neither the reworked plan nor a sidecar. A rewrite that rewords its lines scores high here even when it keeps the content, so read it alongside `after` and `sidecar`.

Results cache per run, arm, and case under `results/<run>/<arm>/<id>.json`, with the raw transcript and any stderr beside each. Rerunning the same run label skips finished cases. A session that exits non-zero keeps its transcript but writes no result, so the next run retries it. `--limit`, `--case`, `--model`, `--concurrency`, `--max-turns`, and `--dry-run` narrow or preview a run.

#### Calibration

Compare arms only once the `current` arm reproduces what live sessions did after the same deny: a tail of sessions with three or more `wc` calls, and most finals within 1,000 characters of the limit. Without those signatures the replay lacks the trigger, and the arm comparison says nothing about live sessions.

## Report

`report.ts` reads one run (`--run`, default the latest) and prints one summary row per arm. `--cases` adds a table with one row per case and the `tokens`, `wc`, `after`, and `del` metrics per arm, so the arms can be read side by side on the same plan.

The summary columns:

- `n`: cases with a result.
- `tokens p50`, `tokens max`: median and largest output token count.
- `wc loops`: cases with three or more `wc` calls.
- `edits p50`: median Edit calls.
- `chars p50`: median final plan length, over the cases whose plan file still existed when the session stopped.
- `over 10k`, `near 10k`, `sidecar`: share of cases with that flag set.
- `deleted p50`: median share of the original plan's lines that survive in neither the plan nor a sidecar.

A better arm lands finals under the limit with fewer tokens, no whittle loops, and a `deleted p50` no higher than the shipped text's.
