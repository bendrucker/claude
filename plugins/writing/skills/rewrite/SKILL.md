---
name: writing:rewrite
description: >-
  Rewrite text in direct, concise style. Use when you have functional content
  (an explanation, a draft message, notes) that needs to read as polished prose
  before sending. Strips AI voice, slop, and filler while preserving meaning.
user-invocable: true
context: fork
---

# Rewrite

Rewrite input text to match the style rules in [references/style-rules.md](references/style-rules.md). Preserve all functional information. Change only voice, word choice, and sentence structure.

## Input

$ARGUMENTS

Read input from one of these sources, checked in order:

#### File path

If `$ARGUMENTS` is a path to an existing file, read the file contents.

#### Inline text

If `$ARGUMENTS` contains text, use it directly.

#### Clipboard

If `$ARGUMENTS` is empty, read from the clipboard with `pbpaste`.

## Rewriting

Apply every rule in [references/style-rules.md](references/style-rules.md). Focus on:

- Replacing banned vocabulary and promotional language with natural alternatives
- Removing filler phrases and hedging
- Breaking long compound sentences into shorter ones
- Converting passive voice to active
- Cutting sentences that restate previous ones
- Removing sycophantic openers

Do not add, remove, or restructure the content's meaning. The output should convey the same information in fewer, clearer words.

## Output

Display the rewritten text directly. Do not wrap it in a code block unless the input was code.

If the user asks, copy the result to the clipboard with `pbcopy`.
