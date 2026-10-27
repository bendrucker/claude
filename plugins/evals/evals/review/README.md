# `evals:review` Suite

Each case hands the session a frozen climb PR from this repo and asks whether its claimed gain holds. The with arm loads the `evals` plugin, so it can dispatch `evals:review`. The without arm is the main model reviewing the same PR alone, which measures whether the agent adds anything.

## Cases

A case's `fixture.sh` rebuilds a seed from [`seeds/`](seeds/): the base tree, a head branch carrying the PR's patch, the PR body served through the `packages/eval-stubs` `gh`, and every run the body links under `runs/<run id>/aggregate-result.json`. [`scripts/plant.ts`](scripts/plant.ts) then plants the case's flaw in the head tree, the body, or the runs.

- `dev` is #1506, a climb whose gain held, as `stop-clean` plus one planted variant per check:
  - `stop-noise`: the two baseline replicates disagree by about the size of the gain.
  - `stop-drift`: the without arm rises with the with arm, while the body says it held flat.
  - `stop-leakage`: the added skill text names the `price-cache` holdout case's details.
  - `stop-grader-edit`: the PR loosens the `short-close` grader its target is scored by.
  - `stop-unregistered`: the body doesn't state a target or guards.
  - `stop-holdout-fell`: the holdout candidate runs fall, while the body reports a rise.
  - `stop-versions`: the candidate runs moved to another Claude Code version and model.
- `holdout` is the real PRs that closed on their evidence, frozen at the state they asked for review in: #1509 and #1510 never ran their holdout and rest their guards on one or two runs a side, and #1520 topped up only the cases in question and had not run its holdout.

The seeds hold each PR's body, patch, the suite's cases and graders at its base (packed in `tree.tar`, since the runner would read an unpacked `case.yaml` as one of this suite's cases), and the CI results of its runs, slimmed to the fields `compare.ts` reads. #1506's runs are regraded against its suite at the base commit, as its body states.

## Graders

| Grader | Cases | Checks |
| --- | --- | --- |
| `verdict` | every case | The reply ends on the expected `Verdict: holds` or `Verdict: fails`. |
| `names-flaw` | every case but `stop-clean` | An `llm` judge on `claude-opus-5-5`: the reply names the planted flaw, or for a holdout case one of the PR's real flaws. |
| `review-dispatched` | every case, with arm | Indicator: the session dispatched `evals:review`. |

`stop-clean` is the only case whose verdict is `holds`, so it alone guards against a reviewer that fails everything.

## Gaps

- Saturation and judge-only gains have no case, because #1506's suite has no `llm` grader and no case at the ceiling on both arms that the body counts.
- The holdout has no clean case, and it ran in every replicate of the first climb, so a later candidate needs new real-PR seeds to show a holdout gain.
- The session reads results the fixture already downloaded. A real review downloads them with `gh run download`, which the stub refuses.

## Running

The suite is `.local-only`. Edit [`scripts/spec.ts`](scripts/spec.ts) or [`scripts/plant.ts`](scripts/plant.ts) and run `bun plugins/evals/evals/review/scripts/gen.ts`, since every case file and example is generated.

- `bun evals/native/run.ts plugins/evals/evals/review --ref <ref> -- --tag dev --runs <n>` runs the plugin at `<ref>` against the no-plugin arm. A case runs up to 60 turns.
- `bun evals/native/check.ts plugins/evals/evals/review` tests the `verdict` regex against [`examples/`](examples/).
- `bun test plugins/evals/evals/review` covers the generator, the committed files, and that each plant changes only the evidence it targets.
