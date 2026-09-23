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
  "trimTo": "# the kept comment, rewritten to stand alone",
  "fact": "the phrase the surviving text must carry",
  "quoted": null,
  "doc": null,
  "source": "jacob/!680 get_records.py:1116",
  "note": "Ben's review note or the rationale for the label"
}
```

- `action`: `"keep"` (its fact must survive), `"trim"` (must be trimmed or
  deleted), or `"rewrite"` (carries a real fact under AI voice and must be
  de-voiced).
- `category`: a `SlopCategory` for `trim`/`rewrite` (`voice` for every
  `rewrite`, and for a `trim` whose cut is the voice), `null` for `keep`.
- `rewrite`: for a `rewrite` fixture, the owner's gold de-voiced text, for hand
  spot-checks. The gate scores the predicted action; rewrite text is checked by
  hand. `null` otherwise.
- `trimTo`: optional, only for blocks where part carries a fact and the rest is
  slop: the owner's gold kept-comment text. It is the minimum a reader needs,
  with its delimiters kept and no leading indentation. The report shows the
  judge's surviving length against it. The gate fails a trim that keeps more
  than `RETENTION_CEILING` of the comment, so the gold must fit under it.
- `fact`: a phrase, or a list of phrases that must all appear in the surviving
  text. Required on every `keep` and on every `trim` with `trimTo`. Each phrase
  must appear in `comment`, and in `trimTo` when one is given. Matching ignores
  case, comment delimiters, backticks, double quotes, and line wrapping, so pick
  short phrases a faithful trim keeps verbatim.
- `quoted`: the phrase `judge/prompt.md` quotes from this fixture. A quoted
  fixture's precision and recall report as a separate bucket, outside the
  headline numbers and the recall floor. The must-keep check still covers it,
  and a test fails when the rubric stops quoting the phrase.
- `doc`: the `DocComment` extraction attaches to a formal doc comment
  (`target`, `subject`, `exported`, `required`), or `null`. Copy it from
  `docCommentOf` over the full source file, since the judge reads it.
- `context`: real source, line-numbered, so the judge can answer the
  what-on-dense question.

## Curation

`keep` fixtures are the ship gate: a judge that drops a justified comment's
fact is wrong, and a trim that keeps the fact passes. A comment whose fact fits
in less text belongs in `trim` with a gold `trimTo`, no matter how well
justified, so a `keep` is already about as short as its fact allows. The keeps
cover a canonical-API-name docstring, why-comments on guards and SQL, a test
constant's rationale, and a plain factual doc that pins the over-rewrite guard.
The `go-` fixtures pin formal doc comments: every Go doc comment keeps its
`Name` lead on a trim, required godoc trims to that lead sentence at most, and
exported godoc keeps its caller contract.
`trim` fixtures cover `restate-the-what`, `narration`, `docstring-scope`,
`section-divider`, and a `voice` cut. `rewrite` fixtures carry a fact under AI
voice (contrastive framing, marketing vocabulary), where the fix is to strip the
voice and keep the fact.
