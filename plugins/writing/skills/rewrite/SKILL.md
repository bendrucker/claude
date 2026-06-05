---
name: writing:rewrite
description: >-
  Rewrite a draft message, explanation, or note to strip AI voice, slop, and
  filler while preserving meaning. Use to polish functional prose before
  sending.
argument-hint: "[file path or text; omit to read input from the clipboard]"
user-invocable: true
context: fork
allowed-tools:
  - Bash
  - Read
---

# Rewrite

Rewrite input text to match the style rules in [references/style-rules.md](references/style-rules.md). Preserve all functional information. Change only voice, word choice, and sentence structure.

## Input

$ARGUMENTS

Read input from one of these sources:

#### File Path

If `$ARGUMENTS` is a path to an existing file, read the file contents.

#### Inline Text

If `$ARGUMENTS` contains text, use it directly.

If `$ARGUMENTS` is empty, ask for the text to rewrite. You may offer to read it from the clipboard.

## Lint

Before and after rewriting, run the lint script to find violations:

```bash
echo "<text>" | bun ${CLAUDE_SKILL_DIR}/scripts/lint.ts
```

Or pass a file path directly:

```bash
bun ${CLAUDE_SKILL_DIR}/scripts/lint.ts path/to/file.md
```

The script outputs one finding per line (`line:col: category: message`).

Fix every hard tell (em dash, copula avoidance, hedging, filler, vocabulary, and the other fixed-phrase categories), then re-run until those are clean.

Treat `marketing verb` findings as advisory. The script flags each one, but the live hook only objects when their weighted sum is high enough, so a lone marketing verb may be fine. Consider each in context and replace the ones that read as promotional rather than driving the count to zero.

## Rewriting

Clear the lint findings as described above, then apply the structural rules from [references/style-rules.md](references/style-rules.md):

- Breaking long compound sentences into shorter ones
- Converting passive voice to active
- Cutting sentences that restate previous ones
- Removing filler phrases and hedging

Do not add, remove, or restructure the content's meaning. The output should convey the same information in fewer, clearer words.

## Output

Display the rewritten text directly. Do not wrap it in a code block unless the input was code.

If the user asks, copy the result to the clipboard.
