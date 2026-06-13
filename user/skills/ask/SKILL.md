---
name: ask
description: Shorthand to make Claude convert a wall of prose into structured questions via the AskUserQuestion tool. Invoke with /ask.
disable-model-invocation: true
---

# Ask

I just read a wall of text from you. Stop and turn it into structured questions with the `AskUserQuestion` tool instead of asking me in prose. You know how the tool works. This is what I care about:

- Pull out each open decision from what you just wrote and make it its own question. Don't bury choices in a paragraph.
- Prefer options that carry a `preview` (the code-example form). A preview lets me select a suggestion and attach my own notes on top of it, so I can accept your direction while adding commentary. Use it whenever an option has a concrete artifact to show: a snippet, a diff, a config block, sample output.
- Only ask about decisions that are genuinely mine. Decide anything with an obvious default yourself and say so.
- Every question should have a recommended option. If you can't recommend one, you don't understand the problem well enough to ask it. Don't ask a blind question and infer my intent from which option I pick. Ask more, smaller questions that let me clarify intent first.
- Err toward asking more questions, not fewer. My invoking this command means I want to be asked.
- The questions in one batch are answered in parallel, so no answer can shape a later question in the same batch. When a follow-up depends on how I answered something, don't cram it into the same batch. Ask the first batch, read my answers, then call the tool again with the next batch informed by them.
