# Git Conflicts Suite

Native suite for the [`git:conflicts`](../../skills/conflicts/SKILL.md) skill: does a session resolve a real rebase or merge conflict to the result both sides intended, finish the operation, and push?

## Frame

A run passes when every conflicted file ends as the result both sides intended, the operation completes, and the branch pushes on top of `main`. Generated files are regenerated from their source with their pins intact.

The skill runs about twice a day, usually to rebase onto `main` while many PRs are in flight, and a bad resolution silently breaks a branch. The recorded instance is a lockfile resolved by deleting `bun.lock` and reinstalling, which floated every dependency and broke CI.

## Cases

Each case replays a conflict from this repo's history. The case's `history/` directory holds the paths involved as patches: the merge base, `main` as it stood when the PR merged, and the branch's commits as they stood before the rebase that resolved them, from the reflog. [`scaffold.sh`](scaffold.sh) builds the repository, pushes `main` and the branch to a local bare `origin`, and starts the operation, which stops on the conflict. The operation is a rebase unless `history/operation` names `merge`. [`scripts/extract.sh`](scripts/extract.sh) writes `history/` from a base, `main`, and branch commit.

| Case | Split | Source | Conflict |
| --- | --- | --- | --- |
| `skill-paragraph` | dev | [#1733](https://github.com/bendrucker/claude/pull/1733) | Merge where both sides add the same `SKILL.md` rule in different words |
| `skill-insert` | holdout | [#1946](https://github.com/bendrucker/claude/pull/1946) | Merge where both sides edit one `SKILL.md` rule and the branch inserts one above it |
| `claude-md-both-2` | dev | [#1716](https://github.com/bendrucker/claude/pull/1716) | Both sides rewrite the same two `CLAUDE.md` paragraphs |
| `claude-md-both` | holdout | [#1702](https://github.com/bendrucker/claude/pull/1702) | Both sides rewrite one `CLAUDE.md` paragraph and its bullet list |
| `code-tests` | dev | [#1683](https://github.com/bendrucker/claude/pull/1683) | Both sides refactor the same function and its scripted test sequences |
| `code-tests-2` | holdout | [#1681](https://github.com/bendrucker/claude/pull/1681) | One-line conflict whose clean-merging tests fail until they take the other side's calls |
| `stacked-squash` | dev | [#1602](https://github.com/bendrucker/claude/pull/1602) | 5-commit rebase whose first commit is an earlier draft of a parent PR that squash-merged |
| `stacked-squash-2` | holdout | [#1705](https://github.com/bendrucker/claude/pull/1705) | 8-commit rebase over two squash-merged parent PRs |
| `dir-rename` | dev | [#1603](https://github.com/bendrucker/claude/pull/1603) | `main` renames a directory, and the branch adds a file in it and edits files at the old path over 3 commits |
| `generated-region` | dev | [#1833](https://github.com/bendrucker/claude/pull/1833) | Both sides regenerate the same row group of a generated table |
| `lockfile-workspaces` | dev | variation of [#1578](https://github.com/bendrucker/claude/pull/1578) | Both sides add a workspace, so `bun.lock` conflicts |
| `lockfile-deps` | holdout | variation of [#1578](https://github.com/bendrucker/claude/pull/1578) | Both sides add a dependency to one workspace, so `package.json` and `bun.lock` conflict |
| `staged-readmes` | dev | [#1740](https://github.com/bendrucker/claude/pull/1740) | Two READMEs, resolve only |
| `staged-platform` | holdout | [#1985](https://github.com/bendrucker/claude/pull/1985) | One context file, resolve only |

The `staged-*` cases balance the suite with requests that stop at the staged resolution.

The lockfile variations use workspace packages with real registry pins held below the latest release. A lockfile regenerated from scratch floats and fails its pin graders. The scaffold installs both sides first, which puts every package in the run's cache for an offline install. `dir-rename` and `generated-region` have no holdout twin, since history yielded one of each.

Splits were assigned by a seeded coin flip within each pair of same-kind cases.

## Grading

Grading runs in the bare origin's [`post-receive`](scripts/post-receive.sh) hook. Eval sessions disable git hooks in the working repository, and a local push starts this one without that config. Each push appends to `.eval-pushed`, and each pushed branch rewrites `.eval-verdicts` with:

- whether an operation was still in progress at the push
- whether the pushed tree holds conflict markers
- whether `main` is an ancestor of it
- whether pushed files match the blobs in the case's `expect`, which `main` actually merged
- the result of the case's `check.sh` (tests, a frozen lockfile install, or file locations), which runs only when the working tree is clean at the pushed commit

The hook writes only to those files. The session never sees a grade.

Shared graders in [`graders/`](graders/) join cases through [`suite.yaml`](suite.yaml): `skill-fired` (an indicator, not scored), `completed`, `committed-clean`, `on-main`, and `pushed`, plus `check-pass` on the cases with a `check.sh`. The `staged-*` cases grade `left-for-user` and `not-pushed` instead. Each case adds regex graders on the resolved working-tree files for the facts each side introduced, taken from `main`'s merged result. `claude-md-both-2`, `code-tests`, and `code-tests-2` also carry an `llm` intent grader.

## Running

```bash
bun evals/native/run.ts plugins/git/evals/conflicts -- --tag dev --runs 2 --scaffold --trust-plugin
bun evals/native/compare.ts --suite plugins/git/evals/conflicts <base1>/aggregate-result.json,<base2>/aggregate-result.json <cand1>/aggregate-result.json,<cand2>/aggregate-result.json
```

Each `<base1>` and `<cand1>` is a run directory under `results/`, which is gitignored. Runs need the Bash sandbox disabled and network for the scaffold's dependency installs.
