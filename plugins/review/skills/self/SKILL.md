---
name: self
description: |
  Self-review your own code changes using a visual diff viewer. Opens a GitHub-style web UI where you can add comments on changed lines. Comments are returned to Claude for action.
allowed-tools: Bash(npx:*)
---

# Self Review

Review your own code changes before committing or requesting peer review.

## Usage

Run `difit` to open the diff viewer:

```bash
npx difit $ARGUMENTS
```

Default targets:
- `.` - All uncommitted changes (staged + unstaged)
- `staged` - Staged changes only
- `working` - Unstaged changes only
- `@ main` - Compare HEAD with main branch

## Workflow

1. Run `difit` with the target diff
2. User reviews in the browser and adds comments on specific lines
3. When the user closes the browser tab, comments are output to stdout
4. Parse the comments and apply the requested changes

## Comment Format

Comments are output in this format:

```
📝 Comments from review session:
==================================================
path/to/file.ts:L42
Comment text here
=====
path/to/other.ts:L10-L20
Comment on a range of lines
==================================================
Total comments: 2
```

## Applying Feedback

For each comment:
1. Read the referenced file and lines
2. Understand the requested change
3. Apply the edit using the Edit tool
4. Confirm the change was made correctly
