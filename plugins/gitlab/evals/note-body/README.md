# Note Body Eval

Shows whether the current model posts a drafted GitLab comment as its text or as a bare `@<path>`, which glab sends literally, and what the `lint` hook's `@<file>` denial does about it.

| Case | Situation |
| --- | --- |
| `drafted-reply` | A reply already drafted in `~/tmp`, to post on an MR |
| `composed-reply` | Write the reply to a markdown file first, then post it |

The `glab` stand-in from [`eval-stubs`](../../../../packages/eval-stubs/) runs in echo mode with [`check.ts`](check.ts), which records a `NOTE-SENT` line for any note of three words or more. A bare `@<path>` is one word, so it records nothing and the `note-sent` grader fails. The without arm runs with no hook, so the A/B measures what the denial recovers:

```bash
bun evals/native/run.ts plugins/gitlab/evals/note-body -- --runs 5
gh workflow run eval.yml --ref <branch> -f suite=plugins/gitlab/evals/note-body -f args='--runs 5'
```
