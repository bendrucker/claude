# Git Conflicts Suite

Native suite for the [`git:conflicts`](../../skills/conflicts/SKILL.md) skill: does a session resolve a real rebase or merge conflict to the result both sides intended, finish the operation, and push?

## Frame

The suite tests `plugins/git/skills/conflicts/SKILL.md`. Every conflicted file ends as the result both sides intended, the operation completes, and the branch pushes on top of `main`. Generated files are regenerated from their source with their pins intact.

The skill runs about twice a day, usually to rebase onto `main` while many PRs are in flight, and "a bad resolution silently breaks a branch." The recorded instance is a lockfile resolved by deleting `bun.lock` and reinstalling, which floated every dependency and broke CI.

## Cases

Each case replays a conflict from this repo's history. `history/` holds the paths involved as patches: the merge base, `main` as it stood when the PR merged, and the branch's commits as they stood before the rebase that resolved them, from the reflog. [`scaffold.sh`](scaffold.sh) builds the repository, pushes `main` and the branch to a local bare `origin`, and starts the operation, which stops on the conflict. [`scripts/extract.sh`](scripts/extract.sh) writes `history/` from a base, `main`, and branch commit.

| Case | Split | Source | Conflict |
| --- | --- | --- | --- |
| `skill-paragraph` | dev | PR 1733 | Both sides add the same SKILL.md rule in different words (merge) |
| `skill-insert` | holdout | PR 1946 | Both sides edit one SKILL.md rule and the branch inserts one above it (merge) |
| `claude-md-both-2` | dev | PR 1716 | Both sides rewrite the same two CLAUDE.md paragraphs |
| `claude-md-both` | holdout | PR 1702 | Both sides rewrite one CLAUDE.md paragraph and its bullet list |
| `code-tests` | dev | PR 1683 | Both sides refactor the same function and its scripted test sequences |
| `code-tests-2` | holdout | PR 1681 | A one-line textual conflict whose test file merges clean but fails until main's scripted sequences take the branch's new calls |
| `stacked-squash` | dev | PR 1602 | 5-commit rebase whose first commit is an earlier draft of a parent PR that squash-merged |
| `stacked-squash-2` | holdout | PR 1705 | 8-commit rebase over two squash-merged parent PRs |
| `dir-rename` | dev | PR 1603 | `main` renames a directory, and the branch adds a file in it and edits files at the old path over 3 commits |
| `generated-region` | dev | PR 1833 | Both sides regenerate the same row group of a generated table |
| `lockfile-workspaces` | dev | variation of PR 1578 | Both sides add a workspace, so `bun.lock` conflicts |
| `lockfile-deps` | holdout | variation of PR 1578 | Both sides add a dependency to one workspace, so `package.json` and `bun.lock` conflict |
| `staged-readmes` | dev | PR 1740 | Two READMEs, resolution only (balance) |
| `staged-platform` | holdout | PR 1985 | One context file, resolution only (balance) |

The lockfile variations use workspace packages with real registry pins held below the latest release. A lockfile regenerated from scratch floats and fails its pin graders. The scaffold installs both sides first, which puts every package in the run's cache for an offline install. `dir-rename` and `generated-region` have no holdout twin, since history yielded one of each.

Splits were assigned by a seeded coin flip within each pair of same-kind cases.

## Grading

Eval sessions disable git hooks in the working repository, so grading runs in the bare origin's [`post-receive`](scripts/post-receive.sh) hook, which a local push starts without that config. Each push appends to `.eval-pushed`, and each pushed branch rewrites `.eval-verdicts`. The verdicts record whether an operation was still in progress at the push, whether the pushed tree holds conflict markers, whether `main` is an ancestor of it, and, from `expect`, whether pushed files match the blobs `main` actually merged. They also record the case's `check.sh` (tests, a frozen lockfile install, or file locations), which runs only when the working tree is clean at the pushed commit. The hook writes only to those files, so the session never sees a grade. Per-case regex graders read the working tree.

Shared graders in [`graders/`](graders/), joined by [`suite.yaml`](suite.yaml): `skill-fired` (indicator), `completed`, `committed-clean`, `on-main`, `pushed`, and `check-pass` on cases with a check. The `staged-*` cases ask only for a resolution and grade `left-for-user` and `not-pushed` instead. Each case adds regex graders on the resolved files for the facts each side introduced, taken from `main`'s merged result, plus one `llm` intent grader where the facts need judgment.

## Running

```bash
bun evals/native/run.ts plugins/git/evals/conflicts -- --tag dev --runs 2 --scaffold --trust-plugin
bun evals/native/compare.ts --suite plugins/git/evals/conflicts --markdown <base1>,<base2> <cand1>,<cand2>
```

Runs need the Bash sandbox disabled and network for the scaffold's dependency installs.
