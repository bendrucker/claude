---
name: ask
description: Shorthand to make Claude convert a wall of prose into structured questions via the AskUserQuestion tool. Invoke with /ask.
disable-model-invocation: true
---

# Ask

Turn the preceding prose into `AskUserQuestion` calls.

- One question per open decision. Don't bury choices in a paragraph.
- Prefer options with a `preview` (snippet, diff, config, sample output). It lets me accept a suggestion and add my own notes on top.
- Only ask decisions that are mine. Decide obvious defaults yourself and say so.
- Every question needs a recommended option. If you can't recommend one, you don't understand it well enough to ask. Ask more, smaller questions instead of inferring intent from one blind pick.
- Err toward more questions. Invoking this means I want to be asked.
- A batch is answered in parallel, so an answer can't shape a later question in the same batch. When a follow-up depends on an earlier answer, split the batches.
