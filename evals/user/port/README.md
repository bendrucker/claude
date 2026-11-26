# `port` Eval

A native `claude plugin eval` suite for the user skill [`port`](../../../user/skills/port/SKILL.md) and the Ports section of [`testing.md`](../../../user/rules/testing.md), which [`suite.yaml`](suite.yaml) wraps into a throwaway plugin. Each case scaffolds a small repo with `fixture.sh` and asks for a port or a nearby change, graded with and without the skill.

The `port-*` cases ask for a shell script to be reimplemented in TypeScript. Each original carries behavior a straight rewrite drops: `uniq -c` padding and a silent exit under `pipefail`, a trailing dash a caller depends on, and output that depends on the clock. Graders check that the session ran both versions on the same inputs, kept the original, and handled the case's quirk. `tests-node-to-bun` converts a node:test suite and checks that its exact-message and error-type assertions survive. The `quiet-*` cases change behavior on purpose, and a `quiet` grader scored on both arms fails when the skill fires on them. Cases are tagged `dev` or `holdout`.

`gh workflow run eval.yml --ref <branch> -f suite=evals/user/port` runs it in CI. `bun evals/native/run.ts evals/user/port -- --tag dev` runs it locally. Results land in the gitignored `results/<timestamp>/`.
