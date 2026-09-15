# Conversion

The procedure for rewriting an existing prompt, skill, or instruction file into the form in [SKILL.md](../SKILL.md). Based on the [Google developer documentation style guide](https://developers.google.com/style) and the [federal plain language principles](https://digital.gov/guides/plain-language/principles/).

## Conversions

Rewrite these constructions wherever they appear:

- Rewrite metaphor and idiom as the literal fact. "Backticks kill the link" becomes "backticked refs don't auto-link".
- Delete epigrams. A short punchy sentence closing a rule for emphasis ("Arming the platform was the whole request.") adds no instruction. If it carries a distinct rule, state that rule plainly.
- Rewrite a personified artifact as an actor and an action. "A title that wants a serial comma" becomes "if the title needs a serial comma".
- Rewrite a contrast frame ("X, not Y") as the positive instruction. Keep an explicit ban alongside it only when the wrong behavior is likely without one.
- Delete cadence connectives. Sentence-opening "So" and "And", a trailing "though", and rhetorical questions add no instruction.
- Replace writerly verbs with common ones: "mine" becomes "review", "arm" becomes "enable", "surface" becomes "report".

## Cuts

Delete these whole rather than converting them:

- Duplicated rules. State each rule once, in the file and section where the model needs it, and cut the restatements. A body that summarizes its own reference file repeats it.
- Second examples. One example per rule. An example repeated in two sections keeps the copy in the section that owns the rule.
- Rationale-only sentences. A sentence that argues a rule is right, restates it with emphasis, or describes the defect the rule prevents adds no instruction.
- Framing sentences. Openers that introduce what the section is about to say ("The most common defect is…") duplicate the heading.
- Cross-references to context the model already has in the same file.

## Preserved Content

Conversion keeps these:

- Every behavioral rule. Plain language changes the style and keeps every rule. A sentence that yields no rule when rewritten is the one to delete.
- Domain terms. "Rebase", "worktree", and "auto-merge" are precise names. Keep them as written. A [leading word](../SKILL.md#leading-words) is a domain term, so keep it too. Convert a metaphor used once for emphasis to its literal fact instead.
- Negative rules and detector lists. A ban on a specific construction is an executable instruction.
- Short concrete examples and before/after pairs. They state a rule more cheaply than added prose does.

## Procedure

For each sentence of the source, extract the instruction, its condition, and its reason. Rewrite as condition, then imperative instruction, then the reason if it passes the test in [SKILL.md](../SKILL.md#sentence-form).

Delete sentences that yield no instruction. Then make a cut pass over the whole document: dedupe rules across sections and files, cap examples at one per rule, and delete rationale that repeats its rule.

Re-read each section afterward and confirm every remaining sentence is an instruction or attached to one.
