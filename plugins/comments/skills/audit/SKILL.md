---
name: comments:audit
description: >-
  Audit code comments for AI slop: restatement, narration/decision-log,
  self-praise, docstring-scope, and section-divider banners. Audits a diff (the
  comments a change introduced) or a whole repo, ranks by intrinsic complexity,
  fans out judging agents, and applies the trims to a fresh branch. Use when
  asked to audit, trim, or clean up code comments, or as the comment pass of a
  branch-finishing flow. Not a general code review: run it only on a change
  that introduces comments.
argument-hint: "[--all] [--base <ref>] [--mr <iid>] [--path <glob>] [--sort <key>] [--limit <n>] [--report] [--fix] [--format <template>] [--max-width <n>]"
allowed-tools:
  - Bash
  - Read
  - Agent
---

# Comments Audit

Find low-value comments and act on them. A comment earns its place when it adds information not readily available in the adjacent code. The judge returns one action per comment: `keep`, `trim` (delete or shorten), or `rewrite` (keep the fact, strip the AI voice). [`judge/prompt.md`](../../judge/prompt.md) holds the comment model and its carve-outs.

Run three steps in order: `preflight` (extract, rank, build the job), one judge agent per shard, and `apply` (write the trims or report them). The run is done when apply has printed its branch name or its report, and every comment it could not splice is listed for the user.

## Scope and Flags

- Default, `--base <ref>`, `--mr <iid>`: diff scope. Judges the comments a change introduced. Default is the working tree (staged, unstaged, and untracked). `--base main` diffs the same working tree against the merge-base with a ref. `--mr <iid>` is a GitLab merge request over `glab`.
- `--all`: repo scope. Judges every tracked code file's comments.
- `--path <glob>`: narrow either scope to matching paths. Repeatable. Use it on a first `--all` run on a large repo to cap the agent count.
- `--sort lines|chars|score` (default `score`): rank by comment complexity so the longest, densest comments judge first.
- `--limit <n>`: keep only the top N ranked comments.
- `--fix`: ask the judge for a concrete suggestion per finding.
- `--report`: at apply time, print findings instead of writing a branch.
- `--format <template>`: at apply time, pipe each edited file through a formatter before committing.
- `--max-width <n>`: at apply time, refuse a splice that would exceed `n` columns. Without it, the limit is the widest line of the comment being replaced or 80 columns, whichever is wider.

## Preflight

Run from the repository being audited. The script resolves the git root itself.

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts preflight $ARGUMENTS
```

The script prints a human summary followed by a machine block:

```
<preflight>
{"agent": "comments:judge", "prompts": ["..."], "jobDir": "...", "count": N, "shardCount": K}
</preflight>
```

At ten shards or fewer, state the comment count, file count, and token estimate in one line and start the judge. Above ten shards, present those numbers and wait for the user to confirm.

`--all` preflight and every apply require a clean working tree. When either reports a dirty tree, commit first, or run apply with `--report`. The default scope audits the working tree, so it can only report until those changes are committed.

## Judge

Make one `Agent` call per entry in `prompts`, all in a single message so they run concurrently. Set `subagent_type` to the block's `agent` and `prompt` to the entry, verbatim. Leave `model` and `effort` unset, because the agent definition pins the ones the eval gate cleared.

```
Agent({ subagent_type: "comments:judge", description: "Judge comment shard <n>", prompt: <prompts[n]> })
```

Each agent writes its shard's verdicts to disk for `apply` and replies with one line of counts.

## Apply

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts apply --job <jobDir> [--report] [--fix] [--format <template>] [--max-width <n>]
```

Apply commits the trims and rewrites to a fresh `comments/audit-<hash>` branch off HEAD through git plumbing, leaving the working tree and current branch untouched. A comment that moved or changed since preflight matches no verdict and is skipped. Apply lists each comment it cannot splice safely with the reason. Hand those to the user.

`--report` prints the findings grouped by file and writes nothing.

### Formatting

`--format` takes a shell command template run from the repo root: `{}` becomes the repo-relative path, the new content arrives on stdin, and stdout is the formatted content. A non-zero exit, output with under half the input's lines, or output that keeps none of the input's comments warns and keeps the unformatted content:

```bash
--format 'ruff format --stdin-filename {} -'
--format 'prettier --stdin-filepath {}'
```

Pass only a formatter the target repo configures. Set `--max-width` to the width the target repo already enforces (its formatter config, `.editorconfig`, or a linter rule). Omit either flag when the repo has no such config.
