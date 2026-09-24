# `diagnosing-bugs` Eval

A native `claude plugin eval` suite for the user skill [`diagnosing-bugs`](../../../user/skills/diagnosing-bugs/SKILL.md), which [`suite.yaml`](suite.yaml) wraps into a throwaway plugin. Each case scaffolds a small Bun project with `fixture.sh`, reports a failure in natural language, and grades the trace and the files left behind, with and without the skill.

The cases cover a reproducible bug handed off to plan mode, a user's wrong theory, a diagnose-only request, a failure the sandbox cannot reach, a performance regression, a fix confirmed by re-running the original reproduction, balance cases where the user names the fix and the right move is light, and quiet cases that mention an error but ask for something else. A `quiet` grader scored on both arms fails when the skill fires on those. Cases are tagged `dev` or `holdout`.

`gh workflow run eval.yml --ref <branch> -f suite=evals/user/diagnosing-bugs -f args='--tag dev'` runs one replicate in CI. `bun evals/native/run.ts evals/user/diagnosing-bugs -- --tag dev` runs it locally with the Bash sandbox disabled. Results land in the gitignored `results/<timestamp>/`.

`bun evals/native/check.ts evals/user/diagnosing-bugs` tests the reply regex graders against the hand-written replies in [`examples/`](examples/).
