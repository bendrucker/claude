# Information Hierarchy

Where each piece of an agent-facing document sits, and what that placement costs. Applies to a skill, a `CLAUDE.md`, a rule under `.claude/rules/`, and any file reached by a pointer.

## Two Budgets

Every document spends one of two budgets. How the agent reaches the document decides which.

#### Context Load

Tokens and attention spent every turn, whether or not the material fires. A skill description, a `CLAUDE.md` line, and an always-on rule are all context load. Three prices set the cost:

- A model-invocable skill spends its description on every session.
- An invoked skill's body is re-injected at every compaction. Keep bodies under roughly 4k tokens.
- A `references/` file costs nothing until its pointer fires.

#### Cognitive Load

What the human must hold: which documents exist, and when each one applies.

Spend cognitive load where human judgment decides the outcome, and remove it where the judgment is mechanical. Making a skill user-invoked trades context load for cognitive load, since it then costs nothing until the user decides it applies.

Material behind a pointer costs only the pointer's own line. Material with no pointer costs no tokens and is reached only when the human remembers it.

## Context Pointers

A context pointer is a reference held in context that names out-of-context material and states the condition for reaching it. A skill's `description` is a pointer. So is a `CLAUDE.md` line naming a rule file, and a `See [references/patterns.md]` link inside a `SKILL.md`.

The pointer's wording decides when the agent reaches the material and how reliably. The target has no effect on this. When required material sits behind a weak pointer, some runs find it and some do not. Sharpen the wording first, and inline the material only after sharpening fails.

Write a pointer to do two things: state what the material is, and list the branches that should trigger reaching it. A branch is a distinct case the document handles.

Prune a pointer harder than the body, because every word of it costs on every turn:

- Put the trigger word first.
- Write one trigger per branch. Synonyms renaming a single branch are one branch written twice.
- Cut identity the body already carries.

## The Ladder

A document holds two content types. Steps are the ordered actions the agent performs. Reference is definitions, rules, and facts consulted on demand. A document can be all steps, all reference, or both.

Place each piece on a ladder ranked by how immediately the agent needs it:

1. **In-file step**: what the agent does, in order.
2. **In-file reference**: consulted on demand while the document runs. A flat set of peer rules on one rung is a correct arrangement, so keep it flat.
3. **Disclosed reference**: a separate file behind a pointer, loaded when the pointer fires. Ranges from a sibling in `references/` to an external doc any skill can point at.

Pushing too little down bloats the top. Pushing too much down hides material the agent needs.

## Progressive Disclosure

Move material down the ladder, out of the main file and behind a pointer, so the top stays legible.

Use branching as the test. Inline what every branch needs, and disclose what only some branches reach.

In a document with steps, in-file reference that belongs one rung lower buries them, and the agent then attends to a buried step inconsistently across runs. Disclose to reduce that variance, not only to save tokens.

## Co-Location

Once the ladder decides how far down a piece sits, co-location decides what sits beside it. Keep a concept's definition, rules, and caveats under one heading.

Test a section by reading it alone: it should answer the question it names without sending the reader elsewhere in the file.

Co-location and duplication are separate failures. Duplication repeats one meaning in two places. Scattering splits one meaning across many.

## Sprawl

A document can be too long while every line in it is live and unique. Attention thins across the excess, and every added line is another to keep current.

Cure sprawl with the ladder. Disclose reference behind pointers, then split by branch or by sequence so each path carries only what it needs.

## Splitting

Splitting one document into two spends one of the two budgets, so split only when the cut pays for itself.

Split by sequence when later steps tempt the agent to finish the current one early. Hiding them drives more work on the step in front of it. Merging two sequences has the reverse effect, exposing each step to everything that follows.

Hiding later steps requires a real context break, meaning a hand-off or a subagent dispatch. An inline call leaves them in context.

Split by invocation when two branches of one skill need different frontmatter: a different model, different `allowed-tools`, or one branch routed by the model while the other stays user-invoked.
