# `performance:hill-climb` Frame Eval

A native `claude plugin eval` suite for the front of `performance:hill-climb`: the Frame and the Checkpoint. Each case scaffolds a small Go repo with `fixture.sh`, hands the session `/performance:hill-climb`, and grades what it writes before the first candidate. Nothing builds or runs, so a case costs one read-and-write session instead of a climb.

## Cases

`docsync` is an unattended, dispatched climb whose brief is wrong about the workload. The brief reads "Hill-climb `docsync sync` startup, harness at bench/, report back", and `append_system_prompt` says nobody will answer. The session stops at the end of the Frame and writes `bench/CLIMB.md`. [`truth.json`](docsync/truth.json) holds what a good Frame records:

| Check | Where | Ground truth |
| --- | --- | --- |
| `mismatch` | notes or reply | The `bench/` fixture's lockfile matches its manifest, so every benchmark run takes the up-to-date exit and skips fetch, apply, and index. |
| `waits` | notes or reply | A maintainer runs the sync after each upstream release and waits for it before opening the docs PR (README usage). |
| `time-split` | notes or reply | The release-sync log puts 133.6s into fetch (71.82s) and apply (57.89s). |
| `parallelism` | Rules | Fetch downloads 38 archives one at a time, so the Rules say whether parallelism is in scope. |
| `assumed` | Rules | The share of the eight Frame items the brief leaves open (ceiling, fast signal, guard, side effects, scope, inputs, budget, parallelism) marked `assumed: <value>`. |
| `checkpoint` | notes | A Checkpoint section with content. |

The metric is left out of `assumed`, since the brief names a target that the evidence contradicts.

`logship` and `ledgerroll` are candidate-ranking controls. Each hands the session a settled `frame.md` and a `pprof -top -cum` listing and asks for the Checkpoint's ranked list:

| Case | Item | Label | Gain |
| --- | --- | --- | ---: |
| `logship` | `dedupe` compares each key against every kept key | win | 43.9% |
| `logship` | `regexp.MustCompile` per line at two sites | win | 24.2% |
| `logship` | `Stats.Inc` takes a mutex per event | trap | 0.5% |
| `logship` | `fanOut` resolves regions serially under a concurrency `TODO` | trap | ≤3.7% |
| `ledgerroll` | `decodeRecord` unmarshals into `map[string]any` | win | 11% |
| `ledgerroll` | `aggregate` re-sorts a group after every append | win | 10% |
| `ledgerroll` | `renderRow` formats with `fmt.Sprintf` | win | 8% |
| `ledgerroll` | `groupKey` builds a map key with `fmt.Sprintf` | win | 6% |
| `ledgerroll` | gzip decompression of a fixed-format feed | trap | 0% of a 31% entry |

The `logship` fan-out is a trap because CPU is 0.99 of wall on 2 vCPU. On `ledgerroll`, ranking by raw share puts gzip first, and the two `Sprintf` wins share one 14% entry split only in the peek listing.

## Graders

[`scripts/score.ts`](scripts/score.ts) is the headline score. It reads each case's `truth.json` by `kind`:

- **frame** ([`frame.ts`](scripts/frame.ts)): rebuilds the notes file from the trace's Write and Edit calls. A check passes when one paragraph, list item, or table row matches every one of its pattern groups. The composite is the mean of the checks, the checkpoint, and the `assumed` share.
- **ranking** ([`ranking.ts`](scripts/ranking.ts)): finds the reply's candidate list and scores gain-weighted recall@5, traps ranked in the top two (0.5 off the composite each, counted only on an entry that doesn't name a win), the share of candidates citing a profile entry, and whether a list item weighs parallelism.

The regex graders in each case are the runner-side proxies `compare.ts` reads. `docsync`'s read `bench/CLIMB.md`.

## Running

`bun evals/native/run.ts plugins/performance/evals/frame --ref <ref> -- --runs 4` runs the plugin at `<ref>` against a no-plugin baseline, with the Bash sandbox disabled. Add `--ablation none` after `--` to skip the baseline when comparing a second ref. Results land in the gitignored `results/<timestamp>-<label>/`.

- `bun plugins/performance/evals/frame/scripts/score.ts <label>=<results>...` scores every trace and prints per-case, per-arm tables with permutation p-values between every pair of arms. The label renames each results directory's plugin arm, so two refs stay apart.
- `bun evals/native/check.ts plugins/performance/evals/frame` tests the regex graders against [`examples/`](examples/).
