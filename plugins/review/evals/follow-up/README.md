# `review:follow-up` Eval

A native `claude plugin eval` suite for `review:follow-up`. Each case scaffolds a git repo with `fixture.sh`, invokes `/review:follow-up` on a pull or merge request the reviewer commented on, and grades the follow-up report, with and without the plugins. The skill sets `disable-model-invocation`, so every prompt is the slash command. The without arm receives the same text as a plain request.

| Case | Platform | What it holds |
| --- | --- | --- |
| `github-reviewer` | GitHub | A local checkout two commits behind the PR head, a partial fix with an unverified test claim, a fix that introduces a double release, a thread resolved with no reply, and a bot thread `--role reviewer` filters out |
| `gitlab-baseline` | GitLab | Three MR versions with review on version 2, a thread resolved by a system note alone over a mechanical locking fix, a new race from the eviction fix, an unresolved thread that was fixed, and another reviewer's thread the author filter drops |
| `silent-resolve` | GitHub | Four reviewer threads with no author replies: one resolved and fixed, one resolved with no change, one resolved with a mechanical fix, and one unresolved but fixed |
| `multi-round` | GitLab | 19 threads across five files and five versions, reviewed last at version 4, with a mechanical Decimal fix, a partial currency check, an unaddressed thread, a reasoned dismissal, and the rest fixed cleanly |

## Snapshot CLIs

The cases run without network, so `gh` and `glab` answer from a snapshot. Each `fixture.sh` calls [`stubs.sh`](stubs.sh), which bundles [`gh.ts`](gh.ts) and [`glab.ts`](glab.ts) into `$HOME/.review-snapshot/bin` and prepends that directory to `PATH` in the run's `$HOME/.zshenv`, the one startup file the Bash tool sources in an eval run. The fixture then writes `$HOME/.review-snapshot/meta.json` with the PR or MR, its reviews and threads, and the SHAs of each version. Diffs, commits, and file contents come from the scaffolded repo through [`snapshot.ts`](snapshot.ts). The stand-ins cover the REST and GraphQL reads the skill and its helper scripts make, and refuse every write, so a session that tries to post, approve, or resolve gets an error instead of a side effect.

The stub sources sit at the suite's top level because `run.ts --case` prunes every other subdirectory.

## Graders

Each promptfoo rubric became one single-criterion grader, made specific to what the fixture plants. Checks with a mechanical signal use `tool_used`: the `--role reviewer` fetch, the `--resolvable --author` discussion list, reading MR versions, the Explore fan-out, and the safety denials the promptfoo suite set as `disallowed_tools`, now `max: 0` graders that also cover the skill's own write paths, such as a pending GitHub review or a GitLab draft note. `recommendation` is a regex for the Request changes grade every fixture calls for, anchored to the recommendation so a reply that approves and only mentions requesting changes fails. The `Skill` graders on `gitlab-baseline` are plugin-fired indicators, unscored under ablation.

## Running

`bun evals/native/run.ts plugins/review/evals/follow-up -- <args>` runs the suite locally with the Bash sandbox disabled, passing arguments after `--` through to `claude plugin eval`. [`suite.yaml`](suite.yaml) grants Bash. Results land in the gitignored `results/<timestamp>/`. `multi-round` takes the longest, so `--case multi-round` or `-j 4` keeps an iteration short.

`gh workflow run eval.yml --ref <branch> -f suite=plugins/review/evals/follow-up` runs it in CI.

`bun evals/native/check.ts plugins/review/evals/follow-up` tests the regex graders against the replies in [`examples/`](examples/) before spending runs on them.
