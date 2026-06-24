# Fixtures

Labeled comment corpus for the judge eval. Each `*.json` is one introduced
comment with the surrounding source context the judge sees, drawn from the
`whirlai` review corpus and merged main-branch slop.

## Schema

```json
{
  "id": "kebab-case-unique-id",
  "path": "src/integrations/salesforce/master.py",
  "language": "python",
  "kind": "docstring",
  "comment": "the exact comment text, including markers",
  "context": "8-12 surrounding source lines, each prefixed with its 1-based line number",
  "label": "slop",
  "category": "restate-the-what",
  "trimToLines": [1],
  "source": "jacob/!680 get_records.py:1116",
  "note": "Ben's review note or the rationale for the label"
}
```

- `label`: `"slop"` (the judge must flag) or `"ok"` (must-pass negative; the judge must NOT flag).
- `category`: a `SlopCategory` for `slop` fixtures, `null` for `ok`.
- `trimToLines`: optional, only for mixed blocks where some lines are a genuine why and others are slop. The lines worth keeping (relative to the comment).
- `context`: real source, line-numbered, so the judge can answer the what-on-dense question.

## Curation

`ok` fixtures are the ship gate: a judge that flags a justified comment is wrong.
They include canonical-API-name docstrings, genuine why/design rationale, and
regression-test verbosity. `slop` fixtures span the v1 taxonomy
(`restate-the-what`, `narration`, `self-praise`, `docstring-scope`,
`section-divider`).
