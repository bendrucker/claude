---
name: plannotator:gate
description: Hold the working diff or a file for Ben's approval in Plannotator's browser UI and act on his decision until he approves. Use for `review:human`'s browser gate, or when asked to have Ben approve a diff or document in Plannotator.
argument-hint: "[--base <ref>] [<file>]"
allowed-tools:
  - Bash(plannotator review:*)
  - Bash(plannotator annotate:*)
---

# Plannotator Gate

Block on Ben's verdict in Plannotator and fold his feedback in until he approves. For any other Plannotator command or flag, load the `plannotator` skill that Plannotator's installer provides.

## Commands

- Diff: `plannotator review --git --json`, adding `--base <ref>` when the caller resolved one.
- File: `plannotator annotate <file> --gate --json --require-approval`.

Run the command in the background, since Ben's decision can outlast the foreground timeout. Once its output shows `Plannotator session ready: http://localhost:<port>`, post that full URL in chat so Ben can tap it in the Rex iPhone app, which forwards the port and opens the review.

## Decision

- `approved` ends the gate.
- `annotated`: act on the annotations and run the command again.
- `dismissed`, or exit 1 from the annotate command, means not approved: fold the feedback in and run the command again.
- Exit 2 is a startup error: report it and stop.
