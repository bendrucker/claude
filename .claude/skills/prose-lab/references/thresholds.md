# Thresholds

The constants live in `packages/prose-lab/score.ts`.

| constant | value | gates |
| --- | --- | --- |
| `MIN_POSITIVES` | 8 | a pattern leaves `collecting` |
| `MIN_FILES` | 4 | the positives span this many files, so one document cannot stand in for the pattern |
| `MIN_LABELED` | 10 | a candidate's labeled hits before its floor counts |
| `FLOOR` | 0.6 | the Wilson lower bound a candidate clears to be `ready` |

At 10 labeled hits, a candidate clears 0.6 only with all 10 right. At 20, it can miss about 3.

A hit is right when it overlaps a span labeled right or flagged, and wrong when it overlaps a span labeled wrong. Overlap means the same file, the same line, and intersecting columns. A span labeled only unsure counts toward neither.

`score` queues up to 10 unlabeled hits per candidate, spread across files.

## Customization Criteria

The lab works when promoted rules hold their floor at the next sweep and right hits per 1,000 words rise on skill files. It fails when patterns stall below 8 positives over three sittings, or when promoted rules retire within a month. `status` and the rule headers in git history carry the evidence.

Review works when flags from reviewed documents end up assigned to patterns that promote. It fails when they sit without a pattern across three sittings, which the count at the foot of `status` shows.
