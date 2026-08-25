# Information Hierarchy

Where each piece of a document sits, and what it costs to put it there. Applies to any document an agent reads: a skill, a `CLAUDE.md`, a rule under `.claude/rules/`, a file reached by a pointer.

## Two Budgets

Every document spends one of two budgets, and which one it spends is decided by how the agent reaches it.

#### Context Load

Material sitting in the window every turn, spending tokens and attention whether or not it fires. A skill description is context load. So is every line of `CLAUDE.md` and every always-on rule.

Three local facts set the price:

- A model-invocable skill spends its description on every session in the catalog. `disable-model-invocation: true` drops it from the catalog entirely, so a user-invoked skill costs zero until it runs.
- An invoked skill's body is re-injected in full at every compaction, so `SKILL.md` size is a recurring per-compaction cost. Keep bodies under roughly 4k tokens.
- A `references/` file costs nothing until its pointer fires.

#### Cognitive Load

The cost on the human: knowing which documents exist and when to reach for each. The human is the index.

This one is worth spending. Cognitive load is the price of human agency, so put it where human judgment belongs and take it away where the judgment is mechanical. A user-invoked skill trades context load for cognitive load deliberately: it costs nothing until the user decides it applies.

Material behind a pointer escapes context load for the price of the pointer's own line. Material with no pointer at all rides entirely on cognitive load.

## Context Pointers

A context pointer is a reference held in context that names out-of-context material and encodes the condition for reaching it. A skill's `description` is one. A line in `CLAUDE.md` naming a rule file is the same object. A `See [references/patterns.md]` link inside a `SKILL.md` is one too.

The pointer's wording decides when the agent reaches the material and how reliably. The target has no say. When must-have material sits behind a weakly worded pointer, the result is a variance bug: some runs find it and some do not. Sharpen the wording first. Inline the material only after sharpening has failed.

A pointer does two jobs. It states what the material is, and it lists the branches that should trigger reaching it. A branch is a distinct case the document handles, so different runs take different paths through it.

Every word of an always-loaded pointer costs on every turn, so prune it harder than the body:

- Front-load the trigger word. The pointer is where it does its work.
- One trigger per branch. Synonyms that rename a single branch are one branch written twice.
- Cut identity the body already carries.

## The Ladder

A document is built from two content types. Steps are the ordered actions the agent performs. Reference is definitions, rules, and facts consulted on demand. The two mix freely: all steps (a runbook), all reference (a review's angle list), or both.

The decision for each piece is where it sits on a ladder ranked by how immediately the agent needs it:

1. **In-file step**: what the agent does, in order. The primary tier.
2. **In-file reference**: consulted on demand while the document runs. Often a flat peer set, such as every rule of a review on one rung. That flatness is a legitimate arrangement.
3. **Disclosed reference**: pushed into a separate file behind a pointer, loaded only when the pointer fires. Spans a sibling in `references/` through a fully external doc any skill can point at.

Push too little down and the top bloats. Push too much down and the agent misses material it needed. That tension is the whole decision.

## Progressive Disclosure

Progressive disclosure is the move down the ladder: out of the main file, behind a pointer, so the top stays legible. Token savings are a side effect. The point is protecting the hierarchy.

Branching is the cleanest test. Inline what every branch needs. Push behind a pointer what only some branches reach.

When a document has steps, in-file reference that belongs one rung lower buries them, and attending to a step becomes a coin flip. Disclosure is a variance lever before it is a legibility one.

## Co-location

The ladder decides how far down a piece sits. Co-location decides what sits beside it once there. Keep a concept's definition, its rules, and its caveats under one heading so reading one part brings its neighbors along.

The test: the document should read like documentation written for the agent. Grouped material reads that way. Scattered material reads like a changelog.

Co-location is a different failure from duplication. Duplication repeats one meaning in two places. Scattering fragments one meaning across many.

## Sprawl

A document can be too long while every line in it is live and unique. Attention thins across the excess, and every extra line is one more to keep relevant.

The cure is the ladder. Disclose reference behind pointers, then split by branch or by sequence so each path carries only what it needs.

## Splitting

Splitting one document into two always spends one of the two budgets, so the cut has to earn it.

Split by sequence when the later steps tempt the agent to rush the one in front of it. Keeping them out of view drives more digging on the current task. The reverse holds as a warning: merging two sequences exposes each step to everything that follows and invites the rush.

Hiding later steps only works across a real context break, meaning a hand-off or a subagent dispatch. An inline call leaves them in context and clears nothing.

Split by invocation when two branches of one skill want different frontmatter: a different model, a different `allowed-tools`, or one branch the model should route to while the other stays user-invoked.
