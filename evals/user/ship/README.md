# `ship` Eval

A native `claude plugin eval` suite for the user skill [`ship`](../../../user/skills/ship/SKILL.md), which [`suite.yaml`](suite.yaml) wraps into a throwaway plugin. It grades the gating decision only: which review passes a diff warrants. Running the passes, opening the PR, and babysitting CI belong to other skills and cost too much per run.

Each case's `fixture.sh` builds a repository whose branch carries a diff against a local bare `origin`. `append_system_prompt` simulates `/ship` with the case's flags, asks for the plan between `<out>` tags as a one-line plan, an `in:` line, and an `out:` line, and stops the session before any pass runs. Regex graders read those lines: `in-<pass>` holds when the pass is gated in, `not-in-<pass>` when it is left off. `stops` fails a session that loads any skill but ship, and `remote-base` checks the diff was taken against the remote tracking ref, and `review-code-<effort>` checks the inferred effort. The effort and config-only cases tell the session a review bot is available, so the Bot Review Gate has something to decide.

The diff kinds, each with a `dev` and a `holdout` case:

- docs-only: no `review:code`, `simplify`, or `run`
- a pure refactor: `simplify` over `review:code`
- added code comments: `comments:audit`
- prose alongside code: `writing:review`
- a runtime surface: `run`
- tests-only: no `run`
- `--skip` flags, including the old `verify` and `code-review` aliases
- a stack `--base`, whose parent layer carries prose and comments the top layer does not
- a refactor that hides a behavior change: `review:code`, not `simplify`
- prose edited but not committed, which only the plain `git diff` shows: `writing:review`
- effort: `high` on auth-shaped code, `medium` on an ordinary multi-file feature
- config-only with a review bot available: no `review:code` and no bot pass
- balance: an ordinary change that warrants the default plan, with a stale local `main` behind `origin/main`

`gh workflow run eval.yml --ref <branch> -f suite=evals/user/ship -f args='--tag dev'` runs one replicate in CI. `bun evals/native/run.ts evals/user/ship -- --tag dev` runs it locally with the Bash sandbox disabled. Results land in the gitignored `results/<timestamp>/`.

`bun evals/native/check.ts evals/user/ship` tests the regex graders against the hand-written replies and traces in [`examples/`](examples/).
