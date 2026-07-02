# Fixtures

Labeled comment corpus for the judge eval. Each `*.json` is one introduced
comment with the surrounding source context the judge sees, drawn from the
`whirlai` review corpus, merged main-branch slop, and this repo's own audit for
the voice/rewrite cases.

## Schema

```json
{
  "id": "kebab-case-unique-id",
  "path": "src/integrations/salesforce/master.py",
  "language": "python",
  "kind": "docstring",
  "comment": "the exact comment text, including markers",
  "context": "8-12 surrounding source lines, each prefixed with its 1-based line number",
  "action": "trim",
  "category": "restate-the-what",
  "rewrite": null,
  "trimToLines": [1],
  "source": "jacob/!680 get_records.py:1116",
  "note": "Ben's review note or the rationale for the label"
}
```

- `action`: `"keep"` (must-pass negative; the judge must not touch it), `"trim"`
  (must be trimmed or deleted), or `"rewrite"` (carries a real fact under AI
  voice; must be de-voiced).
- `category`: a `SlopCategory` for `trim`/`rewrite` (`voice` for every
  `rewrite`), `null` for `keep`.
- `rewrite`: for a `rewrite` fixture, the owner's gold de-voiced text, for hand
  spot-checks. The gate scores the predicted action; rewrite text is checked by
  hand. `null` otherwise.
- `trimToLines`: optional, only for mixed blocks where some lines are a genuine
  why and others are slop. The lines worth keeping (relative to the comment).
- `context`: real source, line-numbered, so the judge can answer the
  what-on-dense question.

## Curation

`keep` fixtures are the ship gate: a judge that trims or rewrites a justified
comment is wrong. They include canonical-API-name docstrings, genuine
why/design rationale, regression-test verbosity, and a plain factual doc that
pins the over-rewrite guard. `trim` fixtures span the v1 taxonomy
(`restate-the-what`, `narration`, `self-praise`, `docstring-scope`,
`section-divider`). `rewrite` fixtures carry a load-bearing fact under AI voice
(contrastive framing, marketing vocabulary), where the fix is to strip the voice
and keep the fact.
