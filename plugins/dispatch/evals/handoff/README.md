# Dispatch Handoff

Measures how quickly `dispatch:dispatch` hands a task to a new session.

## Frame

- Artifact: [`skills/dispatch/SKILL.md`](../../skills/dispatch/SKILL.md) and the `dispatch.ts` output it injects.
- Behavior: from the request, write a brief, run `dispatch.ts` once with the right flags, and report the session's name, branch, and status, in as few turns as the task allows.
- Motivating failure, from the user: "The real goal here is to reduce the number of turns. The faster the skill works, the better." Across 231 real dispatch episodes, the median took 2 tool calls from the trigger to the first successful run and p90 took 12. The turns went to reading the script or skill source (40 episodes), running `--help` (37), repository lookups (19), probing the environment for the multiplexer (10), and a failed run then retry (8).

## Running

```bash
bun evals/native/run.ts plugins/dispatch/evals/handoff [--ref <ref>] -- --tag dev --runs 4
bun evals/native/compare.ts --suite plugins/dispatch/evals/handoff --markdown <base>,<base> <cand>,<cand>
```

Turns, seconds, and tokens per run come from `compare.ts`. They are the climb's targets, and the graders are its guards. `CLAUDE_CODE_EFFORT_LEVEL` in the operator's shell sets the effort for a whole run.

Every case sources [`fixture-lib.sh`](fixture-lib.sh). It builds a repository with a bare origin inside the workspace and installs the offline `rex`, `wt`, and `claude` stand-ins from [`packages/eval-stubs`](../../../../packages/eval-stubs/). Each stand-in records its calls as plain lines in `.eval-calls`, with each launched prompt in `.eval-briefs.md`. The graders read those two files.

#### Multiplexers

No case refers to a multiplexer. A multiplexer stand-in records each session it opens as a neutral `launch <branch> <path>` line, and the graders read only that line, `wt`, and `allow`. [`mux/`](mux/) contains one file per multiplexer with its environment markers, and `EVAL_MUX` (default `rex`) picks one. Supporting another multiplexer takes a stand-in that writes the same `launch` line and a `mux/<name>.sh`.

## Cases

The floor is the fewest turns a run can take: the Skill load, the prompt `Write`, the run, and the reply for one dispatch. A fan-out batches its `Write`s and its runs into one turn each, so it has the same floor.

| Case | Split | Kind | Floor |
| --- | --- | --- | --- |
| `same-repo-named` | dev | same repo, user names dispatch | 4 |
| `same-repo-approval` | holdout | same repo, short approval of a proposal | 4 |
| `other-repo` | dev | another repository | 4 |
| `other-repo-ho` | holdout | another repository | 4 |
| `stacked` | dev | stack on the current branch | 4 |
| `stacked-ho` | holdout | stack on the current branch | 4 |
| `fan-out-3` | dev | three tasks at once | 4 |
| `fan-out-2` | holdout | two tasks at once | 4 |
| `allow-make-test` | dev | grant a permission | 4 |
| `allow-ho` | holdout | grant a permission | 4 |
| `blocked-permission` | dev | the session reports a permission prompt | 4 |
| `quiet-here` | dev | do it here, no dispatch | 3 |
| `quiet-subagent` | holdout | in-session question, no dispatch | 2 |

## Graders

Shared graders live in [`graders/`](graders/), joined by [`suite.yaml`](suite.yaml).

- `skill-fired`: indicator that the skill loaded.
- `no-launch` and `no-dispatch-skill`: the quiet cases launch nothing and never load the skill.
- `dispatched`, `brief-complete`, `reply-reports`, and each case's argument graders: guards. Argument graders match one line of `.eval-calls`, such as `^wt -C \S*/repos/dotfiles ` or `^allow Bash\(make test`.

To see which waste a change removed, count the runs that read the source with `bun evals/native/calls.ts <results> --match 'dispatch\.ts|SKILL\.md'`.
