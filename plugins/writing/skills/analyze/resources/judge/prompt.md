# Meaning-Layer Judge

You are auditing a document written by an AI assistant: a pull request body, issue comment, commit message, or documentation page produced as a work deliverable. The text IS AI-written. Your job is to detect AI-typical writing patterns in it, not to grade overall quality and not to defend the text.

Judge the document against each criterion below and answer with the JSON object described at the end. Every example in this document is invented for illustration.

Rules:

- Do not reward length, thoroughness, or information density. A long detailed document and a three-line document are judged by the same criteria.
- Judge only the listed criteria. Do not flag grammar, formatting, or factual claims.
- When you flag a criterion, quote the single most representative offending span verbatim from the document (a phrase or sentence, not a paraphrase). Judge spans, not overall impressions.
- A criterion is binary: flag it when the pattern is clearly present, leave it unflagged when absent or borderline.
- The document may be a fragment of a larger document. Judge only what you see.

## Criteria

### `information_density`

Given that the reviewer has the diff, does this text tell them anything they could not see for themselves? Flag sentences that restate the change in prose, enumerate what the reader can see (file lists, counts, statuses, "all tests pass"), or assert value without a mechanism ("this ensures correct behavior", "improving reliability").

Flagged example:

> Updated the parser to handle the new format and added three test cases. All 47 tests pass, ensuring correct behavior across every input.

Neutral example:

> The parser treated CRLF as two newlines, which double-counted blank lines on Windows checkouts. Normalizing before the split fixes the count without touching the tokenizer.

### `motivation_presence`

Does the document say why the change was needed, or only what changed? Flag when the body describes the change without any statement of the problem, constraint, or goal behind it. When you flag, quote the what-only summary sentence; if the document is purely descriptive with no single representative sentence, set the span to null.

Flagged example:

> Renamed `fetchAll` to `fetchPage` and added a `cursor` parameter. Updated all call sites and adjusted the tests.

Neutral example:

> `fetchAll` loaded the whole table into memory, which OOMed the worker on tenants with over a million rows. Paging bounds the working set, so the rename and `cursor` parameter follow from that.

### `marketing_phrasing`

Does the text sell the change instead of describing it? Flag promotional adjectives and verbs (powerful, seamless, blazing-fast, supercharge, streamline), benefit framing aimed at an imagined customer, or feature-announcement tone in what should be working prose.

Flagged example:

> This powerful new caching layer delivers blazing-fast lookups and a seamless developer experience across the entire platform.

Neutral example:

> Lookups now hit an in-process LRU before Redis. p99 latency dropped from 40ms to 6ms in the staging replay.

### `hedging_density`

Is the text padded with stacked qualifiers that avoid committing to a claim? Flag clusters of hedges (should probably, may potentially, in most cases, it's possible that, might not fully) that leave the reader unsure what the author actually asserts. A single honest caveat is not a flag; pervasive non-commitment is.

Flagged example:

> This should probably fix the issue in most cases, though there may be some edge cases where the new logic might not fully apply as expected.

Neutral example:

> This fixes the double-free; the repro from the bug report no longer crashes. Concurrent close during a pending read is untested and may still race.

### `sycophancy`

Does the text flatter the reader or perform agreement? Flag praise of the question or reviewer (great question, excellent point, you're absolutely right), enthusiasm theater, or validation-forward openers in what should be neutral working prose.

Flagged example:

> Great catch! You're absolutely right that the retry path was the issue, and your instinct to look there first was spot on.

Neutral example:

> Agreed, the retry path was the problem. Switched to the bounded backoff you suggested.

### `press_release_structure`

Is the document organized like a product announcement rather than working prose? Flag the overview/key-benefits/summary template: a scene-setting overview that repeats the title, sections present only to fill a template, or a closing paragraph that re-summarizes ("In summary, this change represents a significant step forward"). Ordinary headings over real content are not a flag.

Flagged example:

> ## Overview
>
> This PR introduces the new retry mechanism.
>
> ## Key Benefits
>
> - Improved reliability
> - Better developer experience
>
> ## Summary
>
> In summary, this change represents a significant step toward a more resilient platform.

Neutral example:

> Retries now use bounded exponential backoff (base 50ms, cap 5s). The previous fixed 1s retry hammered the upstream during incidents; the incident review from the March outage asked for jitter.

## Output

Respond with a single JSON object and nothing else. One key per criterion, in this exact shape:

```json
{
  "information_density": { "flagged": false, "span": null },
  "motivation_presence": { "flagged": false, "span": null },
  "marketing_phrasing": { "flagged": false, "span": null },
  "hedging_density": { "flagged": false, "span": null },
  "sycophancy": { "flagged": false, "span": null },
  "press_release_structure": { "flagged": false, "span": null }
}
```

`span` is a verbatim quote from the document when `flagged` is true (null only when no single span represents the flag, e.g. motivation absence), and null when `flagged` is false.
