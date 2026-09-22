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
  "trimToLines": [1],
  "fact": "the phrase the surviving text must carry",
  "quoted": null,
  "source": "jacob/!680 get_records.py:1116",
  "note": "Ben's review note or the rationale for the label"
}
```

- `action`: `"keep"` (its fact must survive), `"trim"` (must be trimmed or
  deleted), or `"rewrite"` (carries a real fact under AI voice and must be
  de-voiced).
- `category`: a `SlopCategory` for `trim`/`rewrite` (`voice` for every
  `rewrite`), `null` for `keep`.
- `rewrite`: for a `rewrite` fixture, the owner's gold de-voiced text, for hand
  spot-checks. The gate scores the predicted action; rewrite text is checked by
  hand. `null` otherwise.
- `trimTo`: optional, only for blocks where part carries a fact and the rest is
  slop: the owner's gold kept-comment text, the minimum a reader needs, with its
  delimiters and no leading indentation. The gate reports the judge's surviving
  length against it.
- `fact`: a phrase, or a list of phrases, the surviving text must carry.
  Required on every `keep` and on every `trim` with `trimTo`, and each phrase
  must appear in `comment` and `trimTo`. Matching ignores case, comment
  delimiters, backticks, quotes, and line wrapping, so pick short phrases a
  faithful trim keeps verbatim.
- `quoted`: the phrase `judge/prompt.md` quotes from this fixture. Quoted
  fixtures report as a separate bucket outside the headline keep precision and
  slop recall, and a test fails when the rubric stops quoting the phrase.
- `trimToLines`: the deprecated line-range form of a partial trim, kept where a
  fixture also exercises the applier's compat path. The lines worth keeping
  (relative to the comment).
- `context`: real source, line-numbered, so the judge can answer the
  what-on-dense question.

## Curation

`keep` fixtures are the ship gate: a judge that drops a justified comment's
fact is wrong, and a trim that keeps the fact passes. A comment whose fact fits
in less text is a `trim` with a gold `trimTo`, however justified, so a keep is
already about as short as its fact allows. The keeps include a canonical-API-name
docstring, why comments, test-constant rationale, and a plain factual doc that
pins the over-rewrite guard. `trim` fixtures span the v1 taxonomy
(`restate-the-what`, `narration`, `self-praise`, `docstring-scope`,
`section-divider`). `rewrite` fixtures carry a fact under AI voice (contrastive
framing, marketing vocabulary), where the fix is to strip the voice and keep the
fact.
