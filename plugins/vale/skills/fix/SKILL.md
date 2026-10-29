---
name: fix
description: Fix Vale alerts in bulk, from tens to hundreds of files, with one rewrite agent per file, run through a Workflow. Use when a Vale run, `writing:scan`, or `prompting:scan` reports more alerts than a hand pass can clear. For one file, edit it directly.
argument-hint: "--config <path> [--level suggestion|warning|error] [--model <name>] <paths...>"
allowed-tools:
  - Bash(bun ${CLAUDE_SKILL_DIR}/scripts/fix.ts:*)
  - Read
---

# Vale Fix

Clear Vale alerts across many files without changing what the prose says. Each file gets one agent that rewrites the sentences holding its alerts. A re-lint then restores any file whose rewrite added an alert it didn't have before.

Run `preflight`, then the Workflow tool, then `apply`.

## Arguments

- `--config <path>`: the `.vale.ini` to lint with. Required. It's the same config the rewrite agents verify against, so pass the plugin's own config, such as `plugins/writing/.vale.ini`.
- `--level <level>`: the lowest severity to fix. Default: `warning`. Alerts below it stay in the baseline and don't count as introduced.
- `--model <name>`: the model each rewrite agent runs on. Default: `sonnet`.
- `<paths...>`: files or directories to lint.

## Preflight

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/fix.ts preflight --config <path> [--level <level>] [--model <name>] <paths...>
```

It prints the alert and file counts, then a `<preflight>` block holding `jobDir`, `argsPath`, `scriptPath`, `files`, and `alerts`. Each file with alerts at the level becomes one shard. Preflight also snapshots the file and its full alert list into the job dir, which is what `apply` restores from.

At ten files or fewer, state the counts and start the Workflow. Above ten, present the file count, the alert count, and a cost estimate of the agents, then wait for the user to confirm.

## Rewrite

Read `argsPath` and call the Workflow tool with the `scriptPath` from the preflight block and `args` set to the parsed contents:

```
Workflow({ scriptPath: <scriptPath>, args: <parsed job.json> })
```

Each agent edits its own file and re-lints it. The workflow returns the agents' fixed and left counts, plus a note for each alert an agent left because fixing it would change the sentence's claim.

## Apply

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/fix.ts apply --job <jobDir>
```

Apply re-lints every shard's file and compares the result with the preflight baseline by check and matched text. A file that gained an alert is restored from its snapshot. The table reports each file as `fixed`, `partial`, `untouched`, or `restored`, with the added alerts for a restored file.

Done when apply has run and you have reported its table, the workflow's notes on alerts left in place, and every restored file. The edits stay in the working tree for the user to review and commit.
