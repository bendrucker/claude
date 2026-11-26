---
name: memory-review
description: Review Claude Code auto-memory for staleness against the session index and the repos each memory names, then propose per-file fixes, retirements, or verified-on dates for Ben to accept one at a time.
argument-hint: "[<memory-dir> | --all]"
disable-model-invocation: true
allowed-tools:
  - 'Bash(sh "${CLAUDE_SKILL_DIR}/scripts/memory-dir.sh")'
  - Bash(date +%F)
---

# Memory Review

Auto-memory drifts. A memory records what was true when it was written. Later work renames the file it cites, merges the PR it waits on, or settles the open question it tracks. Loaded as background context, a stale memory steers later sessions wrong. This pass checks every memory against current evidence and lets Ben decide what changes.

## Arguments

- `<memory-dir>`: review that directory, a `~/.claude/projects/<project>/memory/` path.
- `--all`: review every `~/.claude/projects/*/memory/` directory, one directory at a time, each run to completion before the next.
- Default: the current project's memory directory.

Current project's memory directory: !`sh "${CLAUDE_SKILL_DIR}/scripts/memory-dir.sh"`

Today: !`date +%F`

## Memory Format

A memory directory holds `MEMORY.md`, an index loaded into every session with one `- [Title](file.md) — hook` line per memory, plus one file per fact. Each file opens with frontmatter: `name` (kebab-case slug), `description` (one line, used for recall), and `metadata.type` (`user`, `feedback`, `project`, or `reference`). `metadata` may also include `originSessionId`, `modified`, and `verified`. Bodies link each other with `[[name]]`. `feedback` and `project` bodies follow the fact with `Why:` and `How to apply:` lines.

## Writes

Bash writes under `~/.claude/projects` are sandbox-denied. Make every memory edit with `Write` or `Edit`. Those tools cannot delete a file, so retirements end with one `! rm <paths>` line for Ben to run, listed in the final report.

Edit only what Ben accepts. Re-read a file immediately before editing it, since another session may have changed it during the review.

## Gather Evidence

Load the `observability:session` skill for every session-index step. Refresh the index once through it, then run `${CLAUDE_SKILL_DIR}/scripts/memory-activity.sql` with its querying conventions and `SET VARIABLE dir = '<memory-dir without trailing slash>'`.

Each row gives a file's writes, last write, reads, and recalls (`relevant_memories` injections). A file with no row was written before the index's retention floor or outside any indexed session.

Read `MEMORY.md` and list the memory files. Compare the index with the directory yourself. A pointer to a missing file, a file with no pointer, and a hook that contradicts its file's `description` are each a finding.

Split the memory files into shards of about 12 and dispatch one `analyst` agent per shard, all in one message. Give each agent the brief in [references/checks.md](references/checks.md) verbatim, followed by its file paths, the memory directory, today's date, its files' rows from the activity query, and the session skill's read-only query command and `search` command with every path resolved. Each agent returns one verdict block per file. With 12 or fewer files, run the checks inline instead.

## Verdicts

Give each file one verdict:

- **Current**: every claim checked holds. Propose `metadata.verified: <today>`.
- **Fix**: the fact still applies but a detail is wrong, such as a renamed path, a merged PR still called open, a superseded number, or malformed frontmatter. Propose the exact replacement text.
- **Retire**: the fact is no longer true, the work it tracks finished with nothing left to apply, the repo now records it (a `CLAUDE.md` line, a rule, a skill, code), or another memory duplicates it. Propose deleting the file and its `MEMORY.md` line, and identify the replacement memory when it is a duplicate.
- **Unverifiable**: the evidence needed is unavailable, such as a repo absent from this machine or a claim about Ben's preference with no later sessions bearing on it. Propose nothing and report the reason.

Spot-check agent verdicts before proposing them. Re-run one cited check yourself for each Retire, and for each Fix that changes a fact. Drop a verdict whose evidence does not reproduce.

## Propose

Ask with `AskUserQuestion`, one question per file and up to four files per call. Order Retire first, then Fix, then Current. The consequential decisions then come first.

Each question names the file and the verdict, states the evidence in one sentence with the command or query result behind it, and shows the proposed change. Offer these options:

- `Accept`: apply the change as proposed.
- `Verify instead`: for a Fix or Retire, stamp `metadata.verified: <today>` and leave the content.
- `Skip`: leave the file untouched.

A custom answer replaces the proposal. Apply what it says.

## Apply

Apply each accepted change as soon as its answer arrives:

- Verified-on: add or replace `verified: <YYYY-MM-DD>` under `metadata` in the frontmatter.
- Fix: `Edit` the stated text. When the edit changes what the file is about, update its `description` and the hook on its `MEMORY.md` line in the same pass.
- Retire: `Edit` the file's line out of `MEMORY.md`, add the path to the retirement list, and fix any `[[name]]` link in other memories that pointed at it.

## Report

End with:

- Counts by verdict and by answer.
- Unverifiable files with the reason for each.
- Index findings applied and still open.
- The retirement command, one line: `! rm <path> <path> ...`.

The review is done when every memory file in scope has a verdict, every proposal has an answer, every accepted change is applied, and `MEMORY.md` has exactly one line per file that remains.
