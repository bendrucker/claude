# Dispatch Close

Measures whether `dispatch:close` picks the right way out of a finished session's pane for the state of its pull request.

## Frame

- Artifact: [`skills/close/SKILL.md`](../../skills/close/SKILL.md).
- Behavior: from "close yourself", find the branch's PR and its checks, then run `close` with no PR, `close --handoff` when no check is pending or failing, or `park` and then `pull-request:babysit` while a check is pending or failing.
- Motivating request, from the user: a session that is done but lacks "a successful CI run" goes to "a minimized window", and a background session is fine with "a low probability of re-interacting".

## Running

```bash
bun evals/native/run.ts plugins/dispatch/evals/close [--ref <ref>] -- --tag dev --runs 4
bun evals/native/run.ts plugins/dispatch/evals/close -- --tag holdout --runs 4
bun evals/native/compare.ts --suite plugins/dispatch/evals/close --markdown <base> <cand>
```

Every case sources [`fixture-lib.sh`](fixture-lib.sh). It installs the offline stand-ins from [`packages/eval-stubs`](../../../../packages/eval-stubs/), then bundles [`stand-in.ts`](stand-in.ts) as `claude-dispatch-close`, first on `PATH`. The stand-in records each call as a `claude-dispatch-close <argv>` line in `.eval-calls` and answers `close`, `park`, and `restore` with a pane report. Every pane stays where it is. The fixture pushes a feature branch to a bare local origin. `open_pr` writes the `gh` snapshot with the PR and its `gh pr checks` rows, and `no_pr` replaces `gh` with one that finds no PR for any branch.

The cases load no `pull-request` plugin. A parked run ends after its `pull-request:babysit` `Skill` call fails.

## Cases

| Case | Split | Condition | Expected |
| --- | --- | --- | --- |
| `no-pr` | dev | no PR for the branch | `close` |
| `no-pr-ho` | holdout | no PR for the branch | `close` |
| `ci-pending` | dev | PR open, `test` pending | `park`, then babysit |
| `ci-failing-ho` | holdout | PR open, `lint` failing | `park`, then babysit |
| `ci-green` | dev | PR open, `lint` and `test` pass | `close --handoff` |
| `ci-green-ho` | holdout | PR open, `build`, `lint`, and `test` pass | `close --handoff` |

## Graders

Shared graders live in [`graders/`](graders/), joined by [`suite.yaml`](suite.yaml), and match lines of `.eval-calls`.

- `skill-fired`: the skill loaded.
- `session-arg`: the `close` or `park` call names `--session`.
- `closed`, `no-handoff`, `handed-off`, `parked`, `babysat`: the command each condition expects.
- `no-park`, `no-close`: guards against the command another condition expects.

`check.ts` tests the regex graders against [`examples/`](examples/).
