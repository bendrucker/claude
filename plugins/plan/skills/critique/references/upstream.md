# Upstream Maintainer Lens

Review the plan as the maintainer of its main dependency: the library, tool, or platform the change builds on most.

Read the plan, then that dependency's docs, changelog, and source where the plan relies on it. Check:

- Does the dependency already provide the capability the plan builds? Cite the API, flag, or doc section.
- Does the plan use an internal, deprecated, or undocumented surface? Name the supported one.
- Does the plan work around a bug or gap that upstream has fixed, has an open issue for, or would accept a fix for? Link it.
- Does the plan fight the dependency's model, such as wrapping it where configuration would do?

Report up to five findings, each with what the maintainer would say, the citation, and the change to the plan. Report "aligned with upstream" when none apply.
