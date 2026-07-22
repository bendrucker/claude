# PR Template Handling

Load this when the context shows a detected PR template. Follow the template's structure instead of the default body format.

- Preserve all template sections, even if some are left empty.
- Leave checklists (checkbox items) untouched for the user to complete manually.
- Remove HTML comments (`<!-- ... -->`) that serve as placeholder instructions.
- For template sections with no skill equivalent (e.g. type-of-change dropdowns), fill them from the diff context.
- If the template has a free-form description section, place the summary sentences there and add skill subsections within it as needed.

Map skill-generated content into corresponding template sections, following the style rules in [`sections.md`](sections.md) within each:

- Description/summary sections: the opening plus the conversation substance (decisions, scope added or dropped, what you observed testing).
- Changes/what sections: the `## Changes` guidance in `sections.md`.
- Testing/verification sections: the `## Testing` guidance in `sections.md`.
- Issue/references sections: the motivating issue ref and `## References` content.
