---
name: writing:rewrite
description: >-
  Rewrite a draft message, explanation, or note to strip AI voice, slop, and
  filler while preserving meaning. Use to polish functional prose before
  sending.
argument-hint: "[file path or text; omit to read input from the clipboard]"
user-invocable: true
context: fork
background: false
allowed-tools:
  - Bash
  - Read
  - Skill
---

# Rewrite

Load the `writing:writing` skill for the style rules, then rewrite the input to match them. Keep every piece of functional information and change only voice, word choice, and sentence structure. On top of that skill, prefer specific verbs ("generates a report" over "handles report generation") and keep the tone plain and even.

When the input is the user's own writing rather than model output, first note to yourself its core point and its voice: vocabulary, cadence, bluntness, humor, admitted uncertainty, digressions. Then make the smallest edit that clears the tells. Strip the voice entirely only when it is a model's.

## Input

$ARGUMENTS

If `$ARGUMENTS` is a path to an existing file, read the file. Otherwise treat it as the text itself. If empty, ask for the text to rewrite (you may offer to read it from the clipboard).

## Lint

Lint the draft with Vale before and after rewriting. It prints one alert per line (`path:line:col:check:message`):

```bash
vale --config="${CLAUDE_SKILL_DIR}/../../.vale.ini" --output=line path/to/file.md
```

For a message body (PR, issue, comment), pipe it on stdin with `--ext=.prbody`, or `--ext=.commitmsg` for a commit message.

Re-run until every alert is clean except `marketing verb`. Treat those as advisory: replace the ones that read as promotional in context, since the live hook objects only to a high weighted sum.

## Check

Once Vale is clean, answer the questions in [`references/check.md`](references/check.md) with the rewrite beside the original. Fix what fails and re-check until every answer passes.

## Output

Display the rewritten text as plain prose, in a code block only when the input was code.
