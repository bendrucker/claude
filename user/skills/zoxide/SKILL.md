---
name: zoxide
description: Resolve a named repo, project, or directory to its most likely local path using zoxide's frecency database, so you can jump in and work. Use when the user references a repo/project by name without a path ("work on the honeycomb cli", "open my dotfiles", "the aws provider repo"), or when you need to locate a directory before operating in it.
argument-hint: "[keywords]"
allowed-tools:
  - Bash
---

# Zoxide Repo Resolver

Turn a human reference into an absolute local path. When the user names a repo, project, or directory by name without giving a path, zoxide's frecency database says which directory *this user* visits most under that name. That is the answer.

Invoke whenever:

- The user names a repo/project/directory without a path and you need to act in it ("work on the honeycomb cli", "open my dotfiles", "the aws provider repo").
- A path the user gave doesn't exist and you must infer what they meant.

## Resolve

Raw `zoxide query` opens the database read-write to age scores and prune missing dirs. Under the sandbox it prints the correct path but also writes `could not write to database` to stderr and **sometimes returns rc=1 on a correct answer**. So copy `db.zo` into `$TMPDIR` once and query the copy through `_ZO_DATA_DIR`:

```bash
ZO_SRC="${_ZO_DATA_DIR:-$HOME/Library/Application Support/zoxide}"   # honors a relocated db
[ -d "$ZO_SRC" ] || ZO_SRC="${XDG_DATA_HOME:-$HOME/.local/share}/zoxide"
ZO_TMP="${TMPDIR:-/tmp}/zoxide.$$"; mkdir -p "$ZO_TMP"; cp "$ZO_SRC/db.zo" "$ZO_TMP/db.zo"
z() { _ZO_DATA_DIR="$ZO_TMP" zoxide query "$@"; }

z honeycomb            # best match:  /Users/.../honeycomb-cli
z bendrucker claude    # multi-keyword narrows, in path order
z -l -s provider       # ranked candidates + scores, for disambiguation
```

Reuse the same `$ZO_TMP` copy across queries within one activation. `no match found` (rc=1 from the copy) means zoxide has never tracked such a directory. Say so rather than guessing a path.

## Disambiguate

- One clear best match → use it.
- If the top match is a broad parent (e.g. `/Users/ben/src`) rather than a specific repo, add keywords or run `z -l -s <kw>` and pick the most specific, highest-scored repo.
- If the top two candidates are close in score and are genuinely different targets, present both and let the user pick rather than silently choosing.

## After Resolving

Hand the absolute path to the caller and operate there, with absolute paths or the `worktrunk:wt-switch-create` skill for a worktree. This skill only reads zoxide. It does not run `zoxide add`/`remove`/`edit`/`import` and does not mutate the ranking. The default query already filters to directories that still exist, so the resolved dir is one zoxide believes is present. If a later command shows it's gone, re-resolve with more keywords.

## Scope

zoxide ranks directories by frecency and exposes no per-visit timestamps, so this skill answers "which directory," not "when." For shell-command history ("what/when did I run"), use `atuin:history`.
