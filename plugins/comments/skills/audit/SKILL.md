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
  - Workflow
---

# Comments Audit

Find low-value comments and act on them. A comment earns its place when it adds information not readily available in the adjacent code. The judge returns one action per comment: `keep`, `trim` (delete or shorten), or `rewrite` (keep the fact, strip the AI voice). [`judge/prompt.md`](../../judge/prompt.md) holds the comment model and its carve-outs.

The pipeline is three steps, run in order: `preflight` (extract, rank, build the job), the Workflow tool (judge), and `apply` (write the trims or report them).

## Scope and Flags

- Default, `--base <ref>`, `--mr <iid>`: diff scope. Judges the comments a change introduced. Default is the working tree (staged, unstaged, and untracked). `--base main` diffs the same working tree against the merge-base with a ref. `--mr <iid>` is a GitLab merge request over `glab`.
- `--all`: repo scope. Judges every tracked code file's comments.
- `--path <glob>`: narrow either scope to matching paths. Repeatable. Use it on a first `--all` run on a large repo to cap the agent count.
- `--sort lines|chars|score` (default `score`): rank by comment complexity so the longest, densest comments judge first.
- `--limit <n>`: keep only the top N ranked comments.
- `--fix`: ask the judge for a concrete suggestion per finding.
- `--report`: at apply time, print findings instead of writing a branch.
- `--format <template>`: at apply time, pipe each edited file through a formatter before committing.
- `--max-width <n>`: at apply time, refuse a splice that would exceed `n` columns.

## Preflight

Run from the repository you are auditing. The script resolves the git root itself, so stay in the target repo rather than `cd`-ing into the plugin:

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts preflight $ARGUMENTS
```

The script prints a human summary followed by a machine block:

```
<preflight>
{"scriptPath": "...", "argsPath": "...", "jobDir": "...", "count": N, "shardCount": K}
</preflight>
```

Read the `<preflight>` block. At ten shards or fewer, state the comment count, file count, and token estimate in one line and fan out at once. Above ten shards, present those numbers and **wait for the user to confirm before fanning out**.

`--all` preflight and every apply require a clean working tree. When preflight reports a dirty tree, commit first. When apply reports one, commit first or run it with `--report`. The default scope audits the working tree, so it can only report until those changes are committed.

Every run leaves its comment features beside the verdicts in its job dir. The
job root therefore accumulates (features, verdict) pairs across runs. Preflight reads
them back into an action rate per comment shape (divider rule, ticket id, why
marker, code aligned), which is the share of that shape's judged comments the
judge trimmed or rewrote. It weights the ranking by that rate, capped so no
shape outweighs the file's own comment density: two comments of the same length
rank apart when the judge has been acting on one's shape and keeping the
other's. A shape steers the ranking once thirty pairs carry it. The preflight
summary prints the rate for every shape past that mark and the pair count for
every shape under it, which keeps a shape's evidence visible while it builds.

## Judge

Read `argsPath` (JSON) and call the Workflow tool with the `scriptPath` from the preflight block and `args` set to the parsed contents:

```
Workflow({ scriptPath: <scriptPath>, args: <parsed job-args.json> })
```

Each agent judges one shard and writes its verdicts to disk for `apply` to read. The workflow log carries only a shard count and how many were flagged.

## Apply

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts apply --job <jobDir> [--report] [--fix] [--format <template>] [--max-width <n>]
```

Apply re-extracts the judged files, matches verdicts to comments by id, and commits the trims and rewrites to a fresh `comments/audit-<hash>` branch off HEAD. It uses git plumbing, so the working tree and current branch stay untouched. A comment that moved or changed since preflight matches no verdict and is skipped. Comments the applier cannot splice safely stay in place and are listed with the reason. Hand those to the user for manual handling.

`--report` prints the findings grouped by file and writes nothing. Use it to review before applying, or on a dirty tree.

### Formatting

The applier splices lines without running a formatter. `--format` takes a shell command template: `{}` is replaced with the repo-relative path, the file's new content is piped on stdin, stdout is taken as the formatted content, and the command runs from the repo root. A non-zero exit, output with under half the input's lines, or output that keeps none of the input's comments warns and keeps the unformatted content:

```bash
--format 'ruff format --stdin-filename {} -'
--format 'prettier --stdin-filepath {}'
```

Pass only a formatter the target repo configures. When the repo configures none, omit the flag.

Without `--format`, `--max-width` is the only guard on wrapping. Set it to the width the target repo already enforces (its formatter config, `.editorconfig`, or a linter rule). When the repo enforces none, omit the flag.
