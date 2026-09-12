# plan-gate

Offline eval loop for the `plan` plugin's `ExitPlanMode` gate (`hooks/gate.ts`). It answers two questions without waiting weeks for new sessions: what a rule change would have decided on every past presentation, and how a model reworks a denied plan under one deny text versus another.

## Privacy

`mine.ts` pulls every presentation from the session index, work host included, because the replay needs each session's full history to reproduce state-dependent rules. `data/`, `results/`, and `workdir/` are gitignored and never land in this public repo. The rework runner hands plans to a model only when `host` is `local` (`selectCases` in `scripts/rework.ts`).

## Workflow

Refresh the session index first if it is stale (the session skill owns it):

```bash
bun plugins/claude-code/skills/session/scripts/refresh.ts
```

Then, from this directory:

```bash
bun run mine                                                   # -> data/presents.json
bun run replay -- --save results/replay/current.json           # decisions from the checked-out gate
bun run rework -- --arm current --run opus-current             # headless rework sessions
bun run rework -- --arm target --run opus-current
bun run report -- --run opus-current --cases
```

## Replay

`replay.ts` feeds each session's presentations through `processInput` in order, against a temporary state root, and prints a confusion table of the recorded outcome (`actual`) against the gate's decision now (`replay`). Rows where `actual` is an approval or a user rejection and `replay` is `none` are agreement: the gate passed the plan then and passes it now.

To test a rule change, edit `hooks/gate.ts`, replay with `--against results/replay/current.json`, and read the per-case diff. Presentations from before the 10k threshold (#1293, 2026-08-28) show as `user:rejected` with a `gate:size` replay when a second oversized present passed the 12k-era gate, so treat those rows as an era difference rather than a regression.

## Rework

`rework.ts` replays a size deny: it writes the denied plan into a scratch `plans/` directory, runs `claude -p` with the planning guidelines appended to the system prompt, hands it the arm's deny reason, and records what the session did. `scripts/arms.ts` defines the arms. `current` is the shipped `sizeReason` text. `target` states the character count, a target of about 8,000 characters, and that the limit counts characters rather than bytes.

Every metric is mechanical, read from the stream-json transcript and the files left behind:

- `tokens`: output tokens for the session.
- `wc`: Bash calls that invoke `wc`. Three or more counts as a whittle loop in the summary.
- `edits`: Edit calls against the plan.
- `after`: final plan length in characters, with `over 10k` and `near 10k` (within 1,000) flags.
- `sidecar`: whether the session wrote a supporting file next to the plan.
- `del`: lines of the original plan that appear verbatim in neither the reworked plan nor a sidecar. A rewrite that rewords its lines scores high here even when it keeps the content, so read it alongside `after` and `sidecar`.

Results cache per run, arm, and case under `results/<run>/<arm>/<id>.json`, with the raw transcript beside each. Rerunning the same run label skips finished cases. `--limit`, `--case`, `--model`, `--concurrency`, `--max-turns`, and `--dry-run` narrow or preview a run.

Calibrate before comparing arms: the `current` arm should reproduce the in-situ signatures the audit found (a whittle tail, finals bunched just under 10k). If it does not, the replay lacks the trigger and the arm comparison says nothing about live sessions.
