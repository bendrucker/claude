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
| `skill-insert` | dev | [#1946](https://github.com/bendrucker/claude/pull/1946) | Merge where both sides edit one `SKILL.md` rule and the branch inserts one above it |
| `claude-md-both-2` | dev | [#1716](https://github.com/bendrucker/claude/pull/1716) | Both sides rewrite the same two `CLAUDE.md` paragraphs |
| `claude-md-both` | dev | [#1702](https://github.com/bendrucker/claude/pull/1702) | Both sides rewrite one `CLAUDE.md` paragraph and its bullet list |
| `code-tests` | dev | [#1683](https://github.com/bendrucker/claude/pull/1683) | Both sides refactor the same function and its scripted test sequences |
| `code-tests-2` | dev | [#1681](https://github.com/bendrucker/claude/pull/1681) | One-line conflict whose clean-merging tests fail until they take the other side's calls |
| `stacked-squash` | dev | [#1602](https://github.com/bendrucker/claude/pull/1602) | 5-commit rebase whose first commit is an earlier draft of a parent PR that squash-merged |
| `stacked-squash-2` | dev | [#1705](https://github.com/bendrucker/claude/pull/1705) | 8-commit rebase over two squash-merged parent PRs |
| `dir-rename` | dev | [#1603](https://github.com/bendrucker/claude/pull/1603) | `main` renames a directory, and the branch adds a file in it and edits files at the old path over 3 commits |
| `generated-region` | dev | [#1833](https://github.com/bendrucker/claude/pull/1833) | Both sides regenerate the same row group of a generated table |
| `lockfile-workspaces` | dev | variation of [#1578](https://github.com/bendrucker/claude/pull/1578) | Both sides add a workspace, so `bun.lock` conflicts |
| `lockfile-deps` | dev | variation of [#1578](https://github.com/bendrucker/claude/pull/1578) | Both sides add a dependency to one workspace, so `package.json` and `bun.lock` conflict |
| `staged-readmes` | dev | [#1740](https://github.com/bendrucker/claude/pull/1740) | Two READMEs, resolve only |
| `staged-platform` | dev | [#1985](https://github.com/bendrucker/claude/pull/1985) | One context file, resolve only |
| `lockfile-large` | dev | synthetic | Both sides add a dependency to a 40-dependency npm package, so `package.json` and a 13k-line `package-lock.json` conflict |
| `lockfile-union` | dev | synthetic | Both sides add `yaml` to different workspaces at incompatible ranges, so the text union of `bun.lock` repeats a key and `bun install --frozen-lockfile` rejects it |
| `lockfile-union-2` | holdout | synthetic | Same mechanics with `semver` across `apps/` and `libs/` workspaces |
| `reformat-pass` | dev | variation of 5 modules from `plugins/` and `user/scripts/` | `main` reformats every file with Prettier, and 3 branch commits each change one module's behavior |
| `codemod-rename` | dev | variation of `scripts/list-plugins.ts` | `main` renames a helper across 6 files, and the branch edits a renamed line and adds a file calling the old name |
| `moved-edit` | dev | variation of `scripts/coverage/lcov.ts` | `main` moves a parser to a new file, and the branch fixes a bug in it at the old location |
| `unit-change` | dev | synthetic | `main` switches a `timeout` from seconds to milliseconds and updates every caller, and the branch adds a caller passing seconds |
| `codemod-rename-h` | holdout | synthetic | `main` renames a Python helper across 7 files, and the branch edits a renamed line and adds a module calling the old name |
| `moved-edit-h` | holdout | synthetic | `main` moves a Go parser and its tests to new files, and the branch fixes a bug in it and adds a test row at the old location |
| `unit-change-h` | holdout | synthetic | `main` switches a shell `human_size` from kilobytes to bytes and updates every caller, and the branch edits the function and adds a caller passing kilobytes |
| `lockfile-large-h` | holdout | synthetic | Both sides add a dependency to a 40-dependency npm package, so `package.json` and a 7k-line `package-lock.json` conflict |
| `shell-trace` | holdout | `bendrucker/dotfiles` `50ef69e` to `330ba8e`, branch `3482697` | Rebase of a bootstrap-tracing branch whose zsh and sh installers `main` rewrote. `scripts/install-topics` is modified on the branch and deleted on `main`, and a synthetic fourth commit wraps a step in a trace span |
| `go-ledger` | holdout | variation of `plugins/performance/evals/hill-climb/ledgerroll/repo` | `main` hoists a Go sort out of the aggregation loop, and the branch makes the same sort stable and skips voided records |
| `py-legacy-totals` | holdout | synthetic | `main` deletes a Python module and moves its function into another file, and the branch fixes the function in the old file. The fix belongs in the new home |
| `shell-archive-rename` | holdout | synthetic | Both sides rename one shell script to different paths and edit its callers. The result takes `main`'s `bin/` convention and the branch's name |
| `dirty-stash` | dev | synthetic | Rebase stopped on a one-line conflict with an unrelated tracked edit and an untracked file in the working tree and a foreign stash entry. Only the resolution may be pushed, the dirty files come back, and the stash keeps only the foreign entry |
| `diverged` | dev | synthetic | No operation in progress, and the conflicting `main` commit exists only on origin |
| `cherry-pick` | dev | synthetic | Cherry-pick of a hyphen-trim fix onto a branch that caps the same function's length |
| `rerere-stack` | dev | synthetic | A branch and the branch stacked on it both conflict with a `main` rename on the same hunk, and both must be rebased and pushed |
| `quiet-diff` | dev | synthetic | No operation in progress: `main` and the branch each added a file, and the request is a question about `main` |
| `quiet-squash` | dev | synthetic | No operation in progress: two small branch commits and a request to squash them |

The `staged-*` cases balance the suite with requests that stop at the staged resolution. The `quiet-*` cases are negative controls where the skill must not run. They set `history/operation` to `none`, which makes the scaffold leave the branch checked out without starting anything. They grade `skill-unused` (a `tool_used` on `Skill` with `min: 0` and `max: 0`, scored on both arms) and `not-pushed`, and skip the push graders. `quiet-squash` also grades `squashed`, a regex on the branch's reflog for the soft reset or rebase that replaces the two commits.

Prompts are phrasings taken from real invocations, typos included. `codemod-rename`, `lockfile-workspaces`, and `staged-readmes` use the `/git:conflicts` slash form, which expands the skill into the turn without a `Skill` call. In prompts that say "merge", the session has no PR host and should push the branch and say it cannot merge.

Each of the last five cases is built around a trap, a resolution that completes cleanly and passes a marker check but drops or corrupts one side's intent. `trap/` holds that resolution's files and `resolved/` the correct ones. [`scripts/grade-trap.sh`](scripts/grade-trap.sh) `<case> <trap|resolved>` resolves the case with either and grades it as a run would. A case joins the suite when `resolved/` passes its graders and `trap/` fails one beyond the marker checks. Their manifests and lockfiles exist only inside `history/*.patch` and as files ending in `.fixture`, so dependency scanners never see them and nothing installs them.

The lockfile variations use workspace packages with real registry pins held below the latest release. A lockfile regenerated from scratch floats and fails its pin graders. The scaffold installs both sides first, which warms the run's package cache the way a working checkout would. Sessions reach `registry.npmjs.org` through the suite's `WebFetch(domain:registry.npmjs.org)` grant, which `claude plugin eval` applies to the Bash sandbox too. A session can regenerate a lockfile as it would outside an eval. `dir-rename` and `generated-region` have no holdout twin, since history yielded one of each.

The former holdout twins (`claude-md-both`, `code-tests-2`, `lockfile-deps`, `reformat-pass-2`, `skill-insert`, `stacked-squash-2`, `staged-platform`) are `dev`. Most shared files or a recipe with their dev twin, which leaked a change tuned on one into the other. The holdout cases come from file types and PR families the dev set lacks: a Go sort, a Python module move, a shell rename/rename, and `bendrucker/dotfiles` history, where `shell-trace` includes a modify/delete. `shell-trace` was extracted by running `scripts/extract.sh` with the dotfiles checkout as the working directory. That repository has no Go or Python, so those two cases are variations.

`<side>/.removed` lists paths `scripts/grade-trap.sh` deletes at every stop, for the cases whose correct result removes a file that the operation leaves in the tree.

Cases tagged `long` (`code-tests-long`, `codemod-rename-long`, `staged-platform-long`) start with about 92k tokens of inherited conversation, `history.jsonl`, which puts the first turn near 100k. A run's cost then matches real invocations. Run them with `--tag long`, not `run.ts --case`, which prunes the staged suite to the matched cases and drops the sibling the fixture reads from. Each runs its sibling's scaffold, `history/`, and `check.sh`, and is excluded from `--tag dev`. [`scripts/history.ts`](scripts/history.ts) `<case-dir>` regenerates the file from the sibling's `history/` patches and public repo files pinned at a commit. `--check` exits 1 on drift, and `bun test plugins/git/evals/conflicts/scripts` runs it for every case with a `history.jsonl`.

[`scripts/profile.sql`](scripts/profile.sql) measures field cost: the median cost and turns of each real `git:conflicts` invocation by model and week, subagent turns included. Run it against the session index with `duckdb -readonly -f plugins/git/evals/conflicts/scripts/profile.sql ~/.local/share/claude-sessions/session.duckdb`.

## Grading

Grading runs in the bare origin's [`post-receive`](scripts/post-receive.sh) hook. Eval sessions disable git hooks in the working repository, and a local push starts this one without that config. Each push appends to `.eval-pushed`, and each pushed branch rewrites `.eval-verdicts` with:

- whether an operation was still in progress at the push
- whether the pushed tree holds conflict markers
- whether `main` is an ancestor of it
- whether pushed files match the blobs in the case's `expect`, which `main` actually merged
- the result of the case's `check.sh` (tests, a frozen lockfile install, or file locations), which runs only when the working tree is clean at the pushed commit. It receives the hooks directory's copy of the case's `hidden/`, tests and scripts the session never sees, and the branch's tip before the operation. Packages a case lists in `tools` install beside it at scaffold time. A grade never depends on the network. It writes its output to the hooks directory's `eval-check.log`, which each run collects into `artifacts/`

The hook also exports each pushed non-`main` branch's tree to `.eval-pushed-tree/`, which the per-case graders read. A file the session left unpushed or edited after the push does not count. The hook writes only to those files and the session never sees a grade.

The scaffold mirrors a real clone. It sets `refs/remotes/origin/HEAD`, which the git plugin's hooks and the skill resolve the default branch from. The rebase cases `code-tests`, `claude-md-both`, `dir-rename`, `codemod-rename`, and `stacked-squash-2` also have `history/upstream.patch`, an unrelated change merged to origin's `main` after the clone last fetched. Local `main` and `origin/main` are behind it. A branch rebased onto local `main` fails `on-main` until the session fetches and rebases again. `grade-trap.sh` does that fetch and update after the operation, and `<case> resolved-stale` skips it to show `on-main` failing.

Shared graders in [`graders/`](graders/) join cases through [`suite.yaml`](suite.yaml): `completed`, `committed-clean`, `on-main`, `pushed` (a branch other than `main`), and `no-main-push`, plus `check-pass` on the cases with a `check.sh` and `lease-push` on every case that pushes. No grader checks whether the skill ran, since the harness rejects a zero weight and any positive one scores the skill column for loading. Read that from the trace. `lease-push` reads the trace's Bash commands and fails a `git push` that forces without `--force-with-lease`. The `staged-*` cases grade `left-for-user` and `not-pushed` instead. Each case adds regex graders on the pushed tree's files for the facts each side introduced, taken from `main`'s merged result. `claude-md-both-2`, `code-tests`, and `code-tests-2` also carry an `llm` intent grader.

## Running

```bash
bun plugins/git/evals/conflicts/scripts/pins.ts
bun evals/native/run.ts plugins/git/evals/conflicts --label noskill --remove plugins/git/skills/conflicts -- --ablation none --tag dev --runs 4 --scaffold --trust-plugin
bun evals/native/run.ts plugins/git/evals/conflicts -- --ablation none --tag dev --runs 4 --scaffold --trust-plugin
bun evals/native/compare.ts --suite plugins/git/evals/conflicts <base>/aggregate-result.json <cand>/aggregate-result.json
```

The base column deletes the skill from the staged plugin, and `--ablation none` keeps `claude plugin eval` from dropping the whole plugin for a baseline arm. Both columns keep the git plugin's hooks, so the comparison isolates the skill. The default `--ablation with-without` removes every plugin a case lists, hooks included, so its two-arm run stays for drift checks only. Add `--model claude-sonnet-5-5` after `--` for a smaller-model cell, which overrides every case's model.

`pins.ts` exits 1 when a lockfile case pins a dependency at its latest release, which a regenerated lockfile could not float off. Run it before any paid run. Each `<base>` and `<cand>` is a run directory under `results/`, which is gitignored. Runs need the Bash sandbox disabled and network for the scaffold's dependency installs.
