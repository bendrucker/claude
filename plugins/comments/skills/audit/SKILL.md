---
name: comments:audit
description: >-
  Audit code comments for AI slop: restatement, narration/decision-log,
  self-praise, docstring-scope, and section-divider banners. Audits a diff (the
  comments a change introduced) or a whole repo, ranks by intrinsic complexity,
  fans out judging agents, and applies the trims to a fresh branch. Use when
  reviewing a branch or merge request, or sweeping a slop-heavy codebase.
argument-hint: "[--all] [--base <ref>] [--mr <iid>] [--path <glob>] [--sort <key>] [--limit <n>] [--report] [--fix] [--format <template>]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Workflow
---

# Comments Audit

Find low-value comments and act on them. A deterministic Shiki pass extracts
comments over TextMate grammars, the scope selects which to judge, a fan-out of
Claude Code agents judges each against the owner's comment model, and a
deterministic applier writes the changes to a branch. The judge returns one of
three actions per comment: `keep` (it earns its place), `trim` (it carries no
fact, delete or shorten it), or `rewrite` (it carries a real fact under AI voice,
strip the voice and keep the fact). A comment earns its place when it adds
information not readily available in the adjacent code. See
[`judge/prompt.md`](../../judge/prompt.md) for the full model and carve-outs.

The pipeline is three steps: `preflight` (extract, rank, build the job), the
Workflow tool (judge), and `apply` (write the trims or report them).

## Scope and Flags

Two scopes run the same pipeline. The flags select scope and narrow it:

- Default, `--base <ref>`, `--mr <iid>`: diff scope. Judges the comments a change
  introduced. Default is the working tree (staged plus unstaged). `--base main`
  is the merge-base with a ref. `--mr <iid>` is a GitLab merge request over `glab`.
- `--all`: repo scope. Judges every tracked code file's comments.
- `--path <glob>`: narrow either scope to matching paths. Repeatable. Prefer it on
  a first `--all` run on a large repo to cap the agent count.
- `--sort lines|chars|score` (default `score`): rank by intrinsic comment
  complexity so the longest, densest comments judge first.
- `--limit <n>`: keep only the top N ranked comments.

Both scopes exempt machine-meaningful comments deterministically: lint and
compiler directives (`eslint-disable`, `noqa`, `go:generate`), shebang lines,
and license headers never reach the judge.
- `--fix`: ask the judge for a concrete suggestion per finding.
- `--report`: at apply time, print findings instead of writing a branch.
- `--format <template>`: at apply time, pipe each edited file through a
  formatter before committing.

## Preflight

Run from the repository you are auditing (the script resolves the git root
itself, so stay in the target repo rather than `cd`-ing into the plugin):

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts preflight $ARGUMENTS
```

This extracts and ranks the comments, builds the judging job on disk, and prints
a human summary (`N comments / M files / ~K agents / ~T tokens`) followed by a
machine block:

```
<preflight>
{"scriptPath": "...", "argsPath": "...", "jobDir": "...", "count": N, "shardCount": K}
</preflight>
```

Read the `<preflight>` block. Present the count, file count, and rough token
estimate to the user. **Wait for the user to confirm before fanning out.** Nothing
runs until they do. A 5,000-comment repo is roughly 250 agents; `--path` and
`--limit` cap that.

`--all` requires a clean working tree, because it reads the working tree but
applies from HEAD. Commit or stash first if preflight reports a dirty tree.

## Judge

On confirmation, read `argsPath` (it is JSON) and call the Workflow tool with the
`scriptPath` from the preflight block and `args` set to the parsed contents of
`argsPath`:

```
Workflow({ scriptPath: <scriptPath>, args: <parsed job-args.json> })
```

Each agent reads one shard, judges its comments, and writes verdicts to disk. The
workflow logs a small summary (shard count and how many were flagged). The bulk
verdicts stay on disk, off the conversation, for `apply` to read.

## Apply

```bash
bun <plugin-dir>/skills/audit/scripts/audit.ts apply --job <jobDir> [--report] [--fix] [--format <template>]
```

Default apply re-extracts the judged files and matches verdicts to comments by
id at their current position, applies the trims and rewrites, and commits to a
fresh `comments/audit-<hash>` branch off HEAD. The commit is built with git
plumbing, so the working tree is never modified and the current branch stays
checked out. A `rewrite` replaces the comment span in place with the de-voiced
text, so the diff shows the cleaned comment. A partial trim carries the kept
comment as rewritten text (`trimTo`) and is spliced the same way; a legacy
line-range trim (`trimToLines`) that would strand a mid-sentence fragment is
refused and listed for manual handling instead. A comment that moved or changed
since preflight gets a new id, matches no verdict, and is skipped. Review the
result with `git diff HEAD..comments/audit-<hash>`. Apply requires a clean
working tree. The success message and `--report` both open with a
`N delete / M trim / K rewrite across F files` split, counting only what
auto-applies: a `trim` that keeps nothing is reported as `delete`, and refused
verdicts appear as a `, J to manual handling` tail.

`--report` prints the findings grouped by file (`path:line  action  category
confidence  rationale`, with an old → new preview for each rewrite and a
`keep:` preview for each partial trim) and writes nothing. Use it to review
before applying, or on a dirty tree.

### Formatting

The applier splices lines without running a formatter, which can leave debris a
formatter would fix (a stray blank, a collapsed trailing comment past the line
width). `--format` takes a shell command template: `{}` is replaced with the
repo-relative path, the file's new content is piped on stdin, stdout is taken as
the formatted content, and the command runs from the repo root. A non-zero exit
warns and keeps the unformatted content. Examples:

```bash
--format 'ruff format --stdin-filename {} -'
--format 'prettier --stdin-filepath {}'
```

Pick the formatter from the target repo's own configuration and pass it
explicitly, or omit the flag. NEVER guess at, auto-discover, or auto-execute a
formatter the repo does not configure.

### Manual Handling

Comments the applier cannot change safely are left in place and listed for
manual handling: a comment interleaved with code, a trim that would break a
block delimiter, and a line-range trim whose kept line would open mid-sentence.
Applier-produced lines that exceed the width limit are applied but listed as
warnings to re-wrap by hand.
