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
| `lockfile-large` | dev | synthetic | Both sides add a dependency to a 40-dependency npm package, so `package.json` and a 13k-line `package-lock.json` conflict |
| `reformat-pass` | dev | variation of 5 modules from `plugins/` and `user/scripts/` | `main` reformats every file with Prettier, and 3 branch commits each change one module's behavior |
| `codemod-rename` | dev | variation of `scripts/list-plugins.ts` | `main` renames a helper across 6 files, and the branch edits a renamed line and adds a file calling the old name |
| `moved-edit` | dev | variation of `scripts/coverage/lcov.ts` | `main` moves a parser to a new file, and the branch fixes a bug in it at the old location |
| `unit-change` | dev | synthetic | `main` switches a `timeout` from seconds to milliseconds and updates every caller, and the branch adds a caller passing seconds |

The `staged-*` cases balance the suite with requests that stop at the staged resolution.

Each of the last five cases is built around a trap, a resolution that completes cleanly and passes a marker check but drops or corrupts one side's intent. `trap/` holds that resolution's files and `resolved/` the correct ones. [`scripts/grade-trap.sh`](scripts/grade-trap.sh) `<case> <trap|resolved>` resolves the case with either and grades it as a run would. A case joins the suite when `resolved/` passes its graders and `trap/` fails one beyond the marker checks. Their manifests and lockfiles exist only inside `history/*.patch` and as files ending in `.fixture`, so dependency scanners never see them and nothing installs them.

The lockfile variations use workspace packages with real registry pins held below the latest release. A lockfile regenerated from scratch floats and fails its pin graders. The scaffold installs both sides first, which warms the run's package cache the way a working checkout would. Sessions reach `registry.npmjs.org` through the suite's `WebFetch(domain:registry.npmjs.org)` grant, which `claude plugin eval` applies to the Bash sandbox too. A session can regenerate a lockfile as it would outside an eval. `dir-rename` and `generated-region` have no holdout twin, since history yielded one of each.

Splits were assigned by a seeded coin flip within each pair of same-kind cases.

## Grading

Grading runs in the bare origin's [`post-receive`](scripts/post-receive.sh) hook. Eval sessions disable git hooks in the working repository, and a local push starts this one without that config. Each push appends to `.eval-pushed`, and each pushed branch rewrites `.eval-verdicts` with:

- whether an operation was still in progress at the push
- whether the pushed tree holds conflict markers
- whether `main` is an ancestor of it
- whether pushed files match the blobs in the case's `expect`, which `main` actually merged
- the result of the case's `check.sh` (tests, a frozen lockfile install, or file locations), which runs only when the working tree is clean at the pushed commit. It receives the hooks directory's copy of the case's `hidden/`, tests and scripts the session never sees, and the branch's tip before the operation. Packages a case lists in `tools` install beside it at scaffold time. A grade never depends on the network. It writes its output to the hooks directory's `eval-check.log`, which each run collects into `artifacts/`

The hook also exports each pushed non-`main` branch's tree to `.eval-pushed-tree/`, which the per-case graders read. A file the session left unpushed or edited after the push does not count. The hook writes only to those files and the session never sees a grade.

The scaffold mirrors a real clone. It sets `refs/remotes/origin/HEAD`, which the git plugin's hooks and the skill resolve the default branch from. The rebase cases `code-tests`, `claude-md-both`, `dir-rename`, `codemod-rename`, and `stacked-squash-2` also have `history/upstream.patch`, an unrelated change merged to origin's `main` after the clone last fetched. Local `main` and `origin/main` are behind it. A branch rebased onto local `main` fails `on-main` until the session fetches and rebases again. `grade-trap.sh` does that fetch and update after the operation, and `<case> resolved-stale` skips it to show `on-main` failing.

Shared graders in [`graders/`](graders/) join cases through [`suite.yaml`](suite.yaml): `skill-fired` (an indicator at weight 0, since a single-arm column would otherwise score it), `completed`, `committed-clean`, `on-main`, `pushed` (a branch other than `main`), and `no-main-push`, plus `check-pass` on the cases with a `check.sh` and `lease-push` on every case that pushes. `lease-push` reads the trace's Bash commands and fails a `git push` that forces without `--force-with-lease`. The `staged-*` cases grade `left-for-user` and `not-pushed` instead. Each case adds regex graders on the pushed tree's files for the facts each side introduced, taken from `main`'s merged result. `claude-md-both-2`, `code-tests`, and `code-tests-2` also carry an `llm` intent grader.

## Running

```bash
bun plugins/git/evals/conflicts/scripts/pins.ts
bun evals/native/run.ts plugins/git/evals/conflicts --label noskill --remove plugins/git/skills/conflicts -- --ablation none --tag dev --runs 4 --scaffold --trust-plugin
bun evals/native/run.ts plugins/git/evals/conflicts -- --ablation none --tag dev --runs 4 --scaffold --trust-plugin
bun evals/native/compare.ts --suite plugins/git/evals/conflicts <base>/aggregate-result.json <cand>/aggregate-result.json
```

The base column deletes the skill from the staged plugin, and `--ablation none` keeps `claude plugin eval` from dropping the whole plugin for a baseline arm. Both columns keep the git plugin's hooks, so the comparison isolates the skill. The default `--ablation with-without` removes every plugin a case lists, hooks included, so its two-arm run stays for drift checks only. Add `--model claude-sonnet-5-5` after `--` for a smaller-model cell, which overrides every case's model.

`pins.ts` exits 1 when a lockfile case pins a dependency at its latest release, which a regenerated lockfile could not float off. Run it before any paid run. Each `<base>` and `<cand>` is a run directory under `results/`, which is gitignored. Runs need the Bash sandbox disabled and network for the scaffold's dependency installs.
