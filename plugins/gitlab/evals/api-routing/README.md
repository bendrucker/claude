# API Routing Eval

Shows whether the `gitlab:merge-request` skill, with the retired `gitlab:api` skill folded into [`api.md`](../../skills/merge-request/api.md), still routes the three raw-API situations the old skill covered.

| Case | Situation | Pass | Fail |
| --- | --- | --- | --- |
| `attach-screenshot` | Add `tmp/shot.png` to the description of MR !41 | `glab mr update 41 --attach tmp/shot.png` | loads `gitlab:api` |
| `rerequest-review` | `priya-n` requested changes and the fixes are pushed | `glab mr note create 41 -m '/request_review @priya-n'` | any `mergeRequestReviewerRereview` |
| `slash-branch-file` | Head commit of `feature/rate-limit` through the branches API | `--placeholder b=feature/rate-limit` or `feature%2Frate-limit` | `branches/feature/rate-limit` |

The `glab` stand-in from [`eval-stubs`](../../../../packages/eval-stubs/) runs in snapshot mode and refuses every write, so graders are `tool_used` regexes over the commands a run attempted. A refused write still counts as an attempt, and `append_system_prompt` tells the run to stop after it. `slash-branch-file` is a read, and the stand-in serves `repository/branches/<name>` only for one encoded segment, so a raw slash returns 404.

The branch case asks for the branches endpoint instead of file contents, because `repository/files/config.yaml/raw?ref=feature/rate-limit` takes the slash unencoded in a query and has nothing to route.

On `main`, `attach-screenshot` should fail, because `main` carries no `--attach` guidance. Run the A/B:

```bash
bun evals/native/run.ts plugins/gitlab/evals/api-routing -- --runs 5
bun evals/native/run.ts plugins/gitlab/evals/api-routing --ref main -- --runs 5
bun evals/native/compare.ts <branch results>/aggregate-result.json <main results>/aggregate-result.json
```
