# PR Template Handling

- Preserve all template sections, even if some are left empty.
- Leave checklists (checkbox items) for the user to complete.
- Remove HTML comments (`<!-- ... -->`) that serve as placeholder instructions.
- For template sections with no skill equivalent (e.g. type-of-change dropdowns), fill them from the diff context.
- If the template has a free-form description section, place the opening paragraph from [`sections.md`](sections.md) there.

Map skill-generated content into corresponding template sections, following the style rules in `sections.md` within each:

- Description/summary sections: the opening paragraph and its one follow-up line.
- Changes/what sections: one bullet per conceptual change, even when it spans files. Skip cleanup that follows from the main change. For a schema change, list the tables and columns touched, since file names rarely show them.
- Testing/verification sections: what a test or hand check proves that the status checks won't, such as the falsification ("reverting the fix makes `TestX` fail with `exit 2`") or what you couldn't test and why. Leave pass results and test counts to CI.
- Issue/references sections: the motivating issue ref, plus `Relates to #N` for context. Every link must open for the reviewer.
