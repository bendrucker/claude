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

Load the `writing:writing` skill for the style rules, then rewrite the input to match them. Preserve all functional information. Change only voice, word choice, and sentence structure, conveying the same information in fewer, clearer words.

These rules apply on top of that skill:

- Specific verbs over vague ones. "Generates a report" not "handles report generation."
- No marketing language.
- No excessive enthusiasm.

## Input

$ARGUMENTS

If `$ARGUMENTS` is a path to an existing file, read the file. Otherwise treat it as the text itself. If empty, ask for the text to rewrite (you may offer to read it from the clipboard).

## Lint

Before and after rewriting, run the scan script in single-input mode to find violations. It accepts a file path, inline text, or stdin and outputs one finding per line (`line:col: category: message`):

```bash
bun ${CLAUDE_SKILL_DIR}/../scan/scripts/scan.ts --input path/to/file.md
```

Fix every hard tell (em dash, copula avoidance, hedging, filler, vocabulary, and the other fixed-phrase categories), then re-run until those are clean.

Treat `marketing verb` findings as advisory. The script flags each one, but the live hook only objects when their weighted sum is high enough, so a lone marketing verb may be fine. Consider each in context and replace the ones that read as promotional rather than driving the count to zero.

## Output

Display the rewritten text directly. Do not wrap it in a code block unless the input was code.
