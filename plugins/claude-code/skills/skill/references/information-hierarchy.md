# Information Hierarchy

Where material goes in a document an agent reads: a skill, a `CLAUDE.md`, a rule under `.claude/rules/`, a file behind a pointer.

## Cost

- Material in an always-loaded file spends tokens and attention every turn, whether or not it fires.
- Material behind a pointer costs only the pointer's own line.
- Material nothing points at costs nothing and is reached only when the human remembers it.

A model-invocable skill's description costs tokens every session. Keep an invoked skill's body under roughly 4k tokens, since it is re-injected in full at every compaction. A `references/` file costs nothing until its pointer fires.

## Placement

Put material in the body when every run needs it. Put it in `references/` when only some runs reach it.

Move reference that only some branches need out of a step sequence, even when it is short. Leaving it in place makes the agent attend to the surrounding steps inconsistently across runs, which is a cost beyond the tokens.

Bodies hold two kinds of material: the ordered actions the agent performs, and the definitions and rules it consults while performing them. Keep a flat list of peer rules flat.

## Pointers

A pointer names material outside the context and states when to reach it. A skill's `description`, a `CLAUDE.md` line naming a rule file, and a `See [references/patterns.md]` link are all pointers.

Wording decides whether the agent reaches the material. Sharpen the wording before inlining anything.

Write a pointer to state what the material is and which cases should trigger it. Prune it harder than the body, since it costs every turn:

- Put the trigger word first.
- One trigger per case. Synonyms for one case are that case written twice.
- Cut identity the body already carries.

## Readability

Keep a concept's definition, rules, and caveats under one heading. Test a section by reading it alone: it should answer the question it names without sending the reader elsewhere in the file.

A document can be too long even when every line is live and unique. Attention thins across the excess. Move reference behind pointers, then split by case or by sequence so each path carries only what it needs.

## Splitting

Split a sequence when later steps tempt the agent to finish the current one early. That works only across a real context break: a hand-off or a subagent dispatch. An inline call leaves the later steps in context.

Split by invocation when two branches need different frontmatter: a different model, different `allowed-tools`, or one branch routed by the model while the other stays user-invoked.
