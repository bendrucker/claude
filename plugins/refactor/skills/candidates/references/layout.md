# Survey Layout

One survey per mode, or one survey with a section per mode. Each opens with a scope line, then a ranked table, then a section per ranked row, then the rejected list and the hand-offs.

## Scope Line

Name the repositories, the date, and the runtime and version the verifications ran on. For split, name the churn window and how lines were counted.

## Upstream Table

| Rank | Locations | Hand-rolled | Replacement | LOC removed | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/a.ts:12`, `src/b.ts:40`, `lib/c.ts:7` | Regex escape, 3 copies | `RegExp.escape`, already used in `src/config.ts:55` | ~9 | Low |

## Split Table

| Rank | Path | Lines (code) | Responsibilities | Churn | Hazards |
| --- | --- | --- | --- | --- | --- |
| 1 | `src/server.ts` | 900 (740) | Config, routing, auth, rate limiting, rendering | 14 | Routes register at import. Tests import 12 names. |

## Dedupe Table

| Rank | Copies | Logic | Drift found | Shared home | LOC removed | Risk |
| --- | --- | --- | --- | --- | --- | --- |

## Row Section

Give each ranked row a heading named for the pattern or file, holding:

- Differences: each verified difference as input, old result, new result. Mark unverified claims as unverified. For upstream, say which differences a caller can observe and which only change intermediate text.
- Keep: copies or call sites that stay, each with its reason, such as a directory whose compile target lacks the built-in.
- Cut: for split, the proposed modules with each one's purpose and names, and the definitions whose shared state still needs confirming.
- Harness: the probe inputs, what to compare (the value callers observe, not intermediate text), the tests that pin the old behavior, and for split, the export-list diff, the unedited tests, and the cycle check.

## Rejected

One line per rejected candidate: what and where, then the reason. Name the specific mismatch, such as "the copies differ in about 500 lines, more parameters than a merge removes".

## Hand-offs

One line per top pick: the executing skill, the target, and the row it comes from, such as "`port` (upstream): replace the three regex escapers with `RegExp.escape`, row 1".
