---
name: ask
description: Shorthand to make Claude convert a wall of prose into structured questions via the AskUserQuestion tool. Invoke with /ask.
disable-model-invocation: true
---

# Ask

I just read a wall of text from you. Stop and turn it into structured questions with the `AskUserQuestion` tool instead of asking me in prose.

- Pull out each open decision from what you just wrote and make it its own question. Don't bury choices in a paragraph.
- Give every option a concrete `label` and a `description` of the trade-off. Lead with your recommended option and mark it `(Recommended)`.
- Prefer options that carry a `preview` (the code-example form). A preview lets me select a suggestion and attach my own notes on top of it, so I can accept your direction while adding commentary. Use it whenever an option has a concrete artifact to show: a snippet, a diff, a config block, sample output.
- Use `multiSelect: true` when the choices aren't mutually exclusive.
- Only ask about decisions that are genuinely mine. Decide anything with an obvious default yourself and say so.
