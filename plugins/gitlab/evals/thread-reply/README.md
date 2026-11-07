# Thread Reply Eval

Measures whether native `glab mr note create --reply` and `glab mr note resolve` replace the hand-written `glab api` POST to `discussions/<id>/notes` and PUT of `resolved=true`.

| Case | Situation |
| --- | --- |
| `reply-and-resolve` | Two unresolved threads on MR !89. Reply to `sam-o`'s limiter thread, saying it's fixed in the latest commit, and resolve it |

Graders are `tool_used` regexes over the commands a run attempted: `glab mr note create .*--reply` and `glab mr note resolve` pass, and a `glab api` line naming `discussions/<id>/notes` or `resolved=true` fails. The `glab` stand-in from [`eval-stubs`](../../../../packages/eval-stubs/) runs in snapshot mode and refuses `mr note create` and `mr note resolve` as writes, so the attempt is recorded and the run stops. The system prompt asks for each write once, with no retry through another command, so the first choice is what scores.

On `main`, native commands are absent from the skill, so the case should pass 0/5 there. Run the A/B:

```bash
bun evals/native/run.ts plugins/gitlab/evals/thread-reply -- --runs 5
bun evals/native/run.ts plugins/gitlab/evals/thread-reply --ref main -- --runs 5
bun evals/native/compare.ts <branch results>/aggregate-result.json <main results>/aggregate-result.json
```
