# `tdd` Eval

A native `claude plugin eval` suite for the user skill [`tdd`](../../../user/skills/tdd/), wrapped into a throwaway plugin through [`suite.yaml`](suite.yaml). Each case scaffolds a small TypeScript or Python project with `fixture.sh` and asks for a change test-first, with and without the skill.

The cases cover asking for the seam when the prompt leaves it open, seeing a test fail before the code changes, alternating test and code, substituting only real seams, reading back through the interface, literal expected values, and characterization requests where the right move leaves the code alone. Graders are regexes over the trace and the files the run leaves behind, plus one `llm` grader per ask case. A third of the cases carry the `holdout` tag.

`gh workflow run eval.yml --ref <branch> -f suite=evals/user/tdd -f args='--tag dev'` runs one replicate in CI. `-f ref=<ref>` reads the skill at another ref against this branch's cases, and `-f baseline=<run id>,<run id>` adds [`compare.ts`](../../native/compare.ts) tables against pooled baseline runs.

`bun evals/native/run.ts evals/user/tdd -- <args>` runs the suite locally with the Bash sandbox disabled. Results land in the gitignored `results/<timestamp>/`.
