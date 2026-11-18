# Simplify Lens

Find the smallest change that meets the plan's goal and its stated constraints.

Read the plan, then the code it touches. For each new type, module, file, abstraction, flag, dependency, or step, ask whether the goal survives without it:

- Does existing code, a config option, or a standard-library call already do it? Cite the `file:line` or doc.
- Could one change replace two? Could a deletion replace an addition?
- Does a step exist only to support another step the plan could drop?

Report up to five findings, largest saving first. Each finding states what to remove or replace, what replaces it, the evidence, and what the plan loses. Report "already minimal" when every element earns its place.
