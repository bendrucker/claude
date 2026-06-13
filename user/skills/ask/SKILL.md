---
name: ask
description: Shorthand to make Claude convert a wall of prose into structured questions via the AskUserQuestion tool. Invoke with /ask.
disable-model-invocation: true
---

# Ask

Turn that wall of text into structured questions with the `AskUserQuestion` tool instead of prose. You know the tool. This is what I care about:

- Make each open decision its own question. Don't bury choices in a paragraph.
- Prefer options with a `preview` (the code-example form). It lets me select a suggestion and add my own notes on top, accepting your direction while adding commentary. Use it whenever an option has a concrete artifact: a snippet, diff, config block, sample output.
- Only ask decisions that are genuinely mine. Decide obvious defaults yourself and say so.
- Every question needs a recommended option. If you can't recommend one, you don't understand the problem well enough to ask it. Don't ask blind and infer intent from my pick. Ask more, smaller questions instead.
- Err toward more questions, not fewer. Invoking this command means I want to be asked.
- A batch is answered in parallel, so no answer can shape a later question in the same batch. When a follow-up depends on an earlier answer, split it: ask, read my answers, then call the tool again informed by them.
