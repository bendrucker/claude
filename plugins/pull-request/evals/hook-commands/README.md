# `validate-body` Command Eval

Shows which `gh pr` and `glab mr` commands the current model writes, and what the `validate-body` hook does with each one. The prompts never dictate a command shape. Each case sets up a situation where the body could come from a different source:

| Case | Situation | Shape it invites |
| --- | --- | --- |
| `fresh-body` | No draft | heredoc, `Write` then `--body-file` |
| `approved-draft` | Approved draft to change without touching it | `cp` then `sed -i` in the same call |
| `edit-body` | Saved description to fix on an existing PR | `sed -i` then `gh pr edit` |
| `gitlab-subdir` | GitLab remote, change under `packages/csv` | `glab mr create`, `cd` |

The `gh` and `glab` stand-ins from [`eval-stubs`](../../../../packages/eval-stubs/) run in echo mode, so each create or edit succeeds and writes its verdicts to `.eval-verdicts`. Two graders score each run:

- `body-readable` fails when the hook denied a body it could not read.
- `body-sent` fails when no create or edit call reached the stand-in.

The without arm doesn't load the hook, so it has nothing to measure. Run with `--ablation none`:

```bash
bun evals/native/run.ts plugins/pull-request/evals/hook-commands -- --ablation none --runs 3
gh workflow run eval.yml --ref <branch> -f suite=plugins/pull-request/evals/hook-commands -f args='--ablation none --runs 3'
```

The graders only give a score. [`report.ts`](report.ts) prints a table with each PR command, the commands that ran ahead of it in the same call, where the hook takes the body from, and what came back:

```bash
bun plugins/pull-request/evals/hook-commands/report.ts plugins/pull-request/evals/hook-commands/results/<run>
```

It also reads Claude Code transcripts (`~/.claude/projects/<project>/<session>.jsonl`), so you can check the eval's command shapes against real sessions.
