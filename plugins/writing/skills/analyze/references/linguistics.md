# Linguistic Tooling

Evaluation record for replacing hand-rolled heading and trope detectors with POS-tagger-backed rules (issue #745). This file holds the tagger comparison, the promotion criteria for swapping a tagger-backed classifier into the hook, and the earn/retire rules for each dependency.

All numbers are aggregates over private session corpora. Example headings in this file are invented, never quoted from sessions.

## Modules

`plugins/writing/linguistics/` is importable by both `hooks/` and `skills/analyze/scripts/`:

- `tags.ts`, `preprocess.ts`, `grammar.ts`, `heading.ts`: pure, no tagger imports, safe for hooks. `heading.ts` exports `classifyHeadingBaseline`, the extracted heading heuristic the hook runs today.
- `tagger.ts` plus `compromise.ts`, `wink.ts`, `natural.ts`: adapters mapping each tagger into one coarse tag space (`CoarseTag`), so grammar rules are tagger-neutral and the eval isolates tagging quality.
- `classifiers.ts`: eval-only. It imports the tagger adapters, which are devDependencies.

Hooks must never import tagger adapters. Distributed plugins run from the plugin cache where `bun` auto-install skips devDependencies, so a hook importing one works locally and breaks for every marketplace install.

## Tagger Failure Modes on Headings

PR #744 established why naive tagging fails on terse, title-cased headings:

- Title Case biases taggers toward proper nouns: in "Latency Is the Main Bottleneck" (invented), `Is` reads as part of a proper-noun span and the copula disappears.
- Lowercasing the heading first swings the bias the other way: single-word headings like "Changes" read as verbs, producing a ~45% flag rate where the tuned heuristic flags ~4%.

The adapters defeat the copula half of this with a closed-class surface check: the eight finite copula forms (`is am are was were 's 're 'm`) are recognized lexically regardless of tagger output. That is grammar, not vocabulary, so it does not drift with model habits. The verb-bias half is handled positionally in `grammar.ts`: a finite verb counts as clause evidence only with a preceding subject candidate, never as the entire heading, and attributive participles ("a leaked key") are skipped.

## Heading Classifier Comparison

Three candidates, each instantiated per tagger:

- `finite-verb`: flag only on a finite verb with a preceding subject. Misses imperatives by design.
- `np-test`: flag when the heading fails a noun-phrase parse and shows verb evidence. The most aggressive.
- `hybrid`: the baseline's structural rules (colon clause, relative clause, imperative shape) with tagger judgment replacing the hand-maintained linking-verb and imperative-opener word sets.

Flag rates on the session heading corpus (2,858 unique headings, 2025-12-08 to 2026-06-06):

| classifier | flags | flag rate | baseline agreement |
|---|---|---|---|
| baseline | 151 | 5.3% | 100% |
| finite-verb:compromise | 418 | 14.6% | 86.6% |
| np-test:compromise | 946 | 33.1% | 71.1% |
| hybrid:compromise | 532 | 18.6% | 84.6% |
| finite-verb:wink | 357 | 12.5% | 88.8% |
| np-test:wink | 723 | 25.3% | 78.7% |
| hybrid:wink | 413 | 14.5% | 88.8% |
| finite-verb:natural | 252 | 8.8% | 91.8% |
| np-test:natural | 688 | 24.1% | 79.7% |
| hybrid:natural | 324 | 11.3% | 91.4% |

Flag rate alone does not decide anything: the baseline's 5.3% includes documented misses, and a candidate flagging more could be finding real clauses or hallucinating them. The labeled sample settles which.

## Labeled Sample Results

A 499-row labeled sample (200 disagreement-biased rows plus a 299-row uniform random subset), labeled by grammatical form. Label distribution: 367 noun-phrase, 66 imperative, 29 fragment, 23 clause, 15 interrogative. Precision/recall on the random subset (the unbiased view), where `clause` and `imperative` count as should-flag:

| classifier | precision | 95% CI | recall |
|---|---|---|---|
| baseline | 76.9% | 49.7..91.8 | 20.8% |
| finite-verb:compromise | 41.4% | 25.5..59.3 | 25.0% |
| np-test:compromise | 41.0% | 30.8..52.1 | 66.7% |
| hybrid:compromise | 57.1% | 42.2..70.9 | 50.0% |
| finite-verb:wink | 62.5% | 38.6..81.5 | 20.8% |
| np-test:wink | 40.7% | 28.7..54.0 | 45.8% |
| hybrid:wink | 73.9% | 53.5..87.5 | 35.4% |
| finite-verb:natural | 70.6% | 46.9..86.7 | 25.0% |
| np-test:natural | 45.2% | 33.4..57.5 | 58.3% |
| hybrid:natural | 79.2% | 59.5..90.8 | 39.6% |

What the numbers say:

- The baseline is precision-tuned and recall-starved: it misses four of five true sentence headings, mostly imperatives (the dominant positive class at 66 of 104 labeled positives) that fall outside its nine-opener word set.
- `hybrid:natural` is the only candidate meeting the promotion bar on point estimates: precision at or above baseline with roughly double the recall. The intervals overlap heavily (24 flags in the random subset), so this is direction, not a verdict.
- The expected winner per #744, `hybrid:compromise`, loses on precision: compromise's eagerness to read terse Title Case tokens as verbs produces more false positives than the conservative Brill tagger in `natural`. Tagger conservatism beats tagger richness for this job.
- The `np-test` family buys its recall (58–71%) with unacceptable precision (40–45%).

No promotion happens on these numbers. The next step is a larger labeled pass concentrated on the leader's flags, plus dependency weight as a promotion factor: a hook tagger ships to every plugin install, and `natural` is a far heavier package than `compromise`.

## Synthetic Corpus Results

Ten generated documents (design docs, a postmortem, an evaluation, rollout/capacity/testing plans) yielded 114 unique headings containing zero true sentence headings: untreated model output did not produce the trope at this sample size, so the synthetic corpus measures false positives, not recall. The baseline flagged nothing. Candidates produced 1–15 false positives each, all on conventional heading shapes, and because the corpus is egress-clean the failures can be quoted:

- Numbered section headings ("3.1 Unit Tests", "8. API Contract"): a plural head noun reads as a finite verb with the section number as its subject.
- Trailing participle labels ("Lessons Learned"): the participle fails the noun-phrase parse.
- Colon-prefixed noun phrases ("Testing Strategy: Payments Reconciliation Service").

These shapes are tuning targets for the candidates (bare section-number enumerators, heading-final plural-noun verbs) and committable as regression fixtures.

## Eval Harness

`skills/analyze/scripts/headings-eval.ts` extracts headings from the deliverable-prose corpus exactly as the hook does (text children only, all-inline-code skipped), dedupes them, and runs every classifier:

```bash
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH"
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH" --sample 300   # emit labeling file
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH" --labels tmp/heading-labels.tsv
```

`--sample` writes `tmp/heading-labels.tsv` containing all baseline-vs-candidate disagreements (capped, biased toward informative cases) plus a uniform random sample (unbiased precision/recall). `--labels` scores both subsets separately with Wilson 95% intervals. Labels: `noun-phrase`, `clause`, `imperative`, `interrogative`, `fragment`; `clause` and `imperative` should flag.

Corpus artifacts stay in `tmp/` and never leave the machine: the session corpus spans hosts marked `block_egress`.

## Synthetic Corpus

The session corpus measures precision on the real heading distribution, but it is private and cannot be quoted or committed. A synthetic corpus complements it:

```bash
claude -p --no-session-persistence --setting-sources project \
  "Write a technical design document, roughly 1000 words, in markdown with section headings, for <topic>." \
  > tmp/synthetic-corpus/<slug>.md
```

- `--no-session-persistence` keeps the run out of the session index, so generation does not pollute the corpora the analyze skill mines.
- `--setting-sources project` from a scratch directory drops the user-level writing instructions, so the output is the model's untreated style, the thing the detectors target.
- The output is egress-clean: generated for this purpose, safe to quote in PRs and commit as fixtures.
- Regenerating per model release turns the corpus into a drift tracker. Vocabulary tells change between models ("you're absolutely right" gave way to other verbal tics); the structural detectors should hold across regenerations, and a regression shows up as a recall drop.

Vary the document type (design doc, postmortem, evaluation, rollout plan, capacity plan) so heading styles vary. Evaluate with `--docs`:

```bash
bun skills/analyze/scripts/headings-eval.ts --docs tmp/synthetic-corpus --out tmp/synthetic
```

## Promotion Criterion

A tagger-backed classifier replaces `classifyHeadingBaseline` in the hook only when, on the labeled session sample:

- precision ≥ baseline precision
- recall strictly greater than baseline recall
- zero regressions on the committed seed (`linguistics/heading.test.ts`)

The hybrid family leads as #744 predicted, keeping the heuristic's structure and replacing only the word sets, but with `natural` doing the tagging rather than the expected `compromise` (see Labeled Sample Results). Until a candidate clears the bar with a tight enough interval, the hook keeps the heuristic and the linguistics layer surfaces through the analyze and review skills.

## Trope Pattern Inventory

Where each existing detector class lands:

- Lexical wordlists (`wordlists/*.txt`): stay as word lists. They are cheap, the analyze skill audits their health each run, and tagger machinery adds nothing to an exact vocabulary match.
- Structural regexes in `hooks/tropes.ts`: migration candidates, one follow-up issue each, gated by the same corpus-eval discipline as headings:
  - passive voice (`COPULA PARTICIPLE` tag sequence vs. the current participle regex)
  - "not X but Y" parallelism (tag-sequence shape vs. literal `not ... but` matching)
  - cross-sentence negation ("It isn't X. It is Y.")
  - test-result reporting (function-based test, currently uncountable by the structural audit)

## Dependencies

| package | role | earns its place by | retired when |
|---|---|---|---|
| `compromise` | primary tagger | powering the heading eval and the POS-sequence structural signatures in analyze | structural signatures stop producing actionable rules and no classifier is promoted |
| `wink-pos-tagger` | eval comparator | the tagger comparison above | removed once the comparison is recorded here (PR 2) |
| `natural` | eval comparator | the tagger comparison above | removed once the comparison is recorded here (PR 2) |

All three enter as devDependencies (zero session cost, not distributed). `compromise` moves to `dependencies` only when analyze scripts need it at runtime from the plugin cache.
