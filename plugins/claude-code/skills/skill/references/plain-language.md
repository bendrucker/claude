# Plain Language

Rules for skill prose: SKILL.md bodies and reference files. Load this when writing skill instructions or converting an existing skill to plain language. Based on the [Google developer documentation style guide](https://developers.google.com/style) and the [federal plain language principles](https://digital.gov/guides/plain-language/principles/).

Skill prose is instructions for a model performing a task. Judge every sentence by whether it changes the model's behavior. Style aimed at a human reader (rhythm, metaphor, epigram) spends tokens without changing behavior, and a figurative phrasing is a weaker match target than a literal one when the model scans for the rule that applies.

## Sentence Form

- Write instructions in the imperative: "Keep the title under 50 characters."
- Put the condition before the instruction: "When the repo has a PR template, follow its sections."
- One instruction per sentence. Split a sentence that stacks an instruction, its exception, and its reason.
- Active voice, with a named actor: the model, the user, or a tool.
- Present tense and common verbs: "use", not "leverage"; "check", not "interrogate".

## Rule Then Reason

State the rule first, in the imperative. Add the reason after it, in one clause, only when knowing why lets the model handle a case the rule doesn't list. Cut a reason that only argues the rule is right.

## Conversions

Rewrite these constructions wherever they appear:

- Metaphor and idiom become the literal fact. "Backticks kill the link" becomes "backticked refs don't auto-link".
- Epigrams get deleted. A short punchy sentence closing a rule for emphasis ("Arming the platform was the whole request.") adds no instruction. If it carries a distinct rule, state that rule plainly.
- Personified artifacts become an actor and an action. "A title that wants a serial comma" becomes "if the title needs a serial comma". "When length earns them" becomes "when the body is long enough to need them".
- Contrast frames ("X, not Y") become the positive instruction. Keep an explicit ban alongside it only when the wrong behavior is likely without one.
- Cadence connectives get deleted. Sentence-opening "So" and "And", a trailing "though", and rhetorical questions add no instruction.
- Writerly verbs become common ones: "mine" becomes "review", "arm" becomes "enable", "surface" becomes "report".

## Cuts

Most of the reduction comes from deleting whole sentences rather than converting them:

- Duplicated rules. State each rule once, in the file and section where the model needs it, and cut the restatements. A SKILL.md that summarizes a reference file repeats it.
- Second examples. One example per rule. An example repeated in two sections keeps the copy in the section that owns the rule.
- Rationale-only sentences. A sentence that argues a rule is right, restates it with emphasis, or describes the defect the rule prevents adds no instruction.
- Framing sentences. Openers that introduce what the section is about to say ("The most common defect is…") duplicate the heading.
- Cross-references to context the model already has in the same file.

## Preserved Content

Conversion keeps these:

- Every behavioral rule. Plain language changes the style and keeps every rule. A sentence that yields no rule when rewritten is the one to delete.
- Domain terms. "Rebase", "worktree", and "auto-merge" are precise names, not jargon to simplify.
- Negative rules and detector lists. A ban on a specific construction is an executable instruction.
- Short concrete examples and before/after pairs. They pin a rule down more cheaply than added prose.

## Procedure

For each sentence of the source, extract the instruction, its condition, and its reason. Rewrite as condition, then imperative instruction, then the reason if it passes the test above. Delete sentences that yield no instruction. Then make a cut pass over the whole skill: dedupe rules across sections and files, cap examples at one per rule, and delete rationale that repeats its rule. Re-read each section afterward and confirm every remaining sentence is an instruction or attached to one.
