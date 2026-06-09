# Linguistic Tooling

The framework for deciding whether a linguistic detector is worth shipping, and the record of applying it to headings (issues #745, #769). It defines four detector layers, the surface-specific bars a detector must clear, and the earn/retire rules for each dependency. The heading classifier comparison is the first detector run through it.

All numbers are aggregates over private session corpora. Example headings in this file are invented, never quoted from sessions.

## Detector Layers

Writing checks sort by the signal they need, and that sorting drives the architecture more than "tagger vs heuristic" does. Each candidate belongs to one layer, and the layer decides the right tool before any code is written:

- **Lexical** (`delve`, `boasts`, "it's worth noting"): a wordlist is optimal. Linguistics adds nothing. The eval is corpus frequency and lift, which the analyze skill already measures.
- **Morphosyntactic** (sentence-shaped headings, passive `COPULA PARTICIPLE`, "not X but Y", correlatives): patterns over part-of-speech sequences that do not reduce to a word list and break as brittle regexes. This is the only layer the tagger stack is the right tool for.
- **Discourse / cross-sentence** (negation flip "It isn't X. It is Y.", escalating triads, question-then-answer cadence): structure above the sentence. Part-of-speech tagging alone does not reach it.
- **Semantic / pragmatic** (reads like marketing, hedging density): no grammar captures it. LLM-judge territory.

The failure mode to avoid is making the tagger the hammer for all four. Before a trope is built as a grammar rule it gets a wordlist-vs-regex-vs-grammar-vs-judge comparison; the migration candidates in the Trope Pattern Inventory each earn the grammar layer or stay where they are. A cheap LLM-judge run is the upper reference: if a judge ties the tagger stack on a trope at acceptable latency, that trope does not belong in the grammar layer.

## Two Surfaces, Two Promotion Bars

The same grammar engine serves two surfaces with opposite tolerances, so promotion is two bars, not one. The eval scores every candidate against both and reports which surface, if any, it clears.

The hook is a PreToolUse nudge on every edit. A false positive is a cheap, ignorable nudge, but frequent ones train the user to dismiss the hook, so it is precision-critical and recall-tolerant. A candidate replaces a hook detector only when, on a labeled session sample with an interval tight enough to act on:

- precision ≥ baseline precision
- recall strictly greater than baseline recall
- zero regressions on the committed seed (`linguistics/heading.test.ts`)

The analyze and review skills are batch and human-in-the-loop. A reviewer triages flags, so precision can be far lower in exchange for recall. A classifier too noisy for the hook can be valuable here. The bar is recall above baseline at a precision a reviewer tolerates, with the false-positive rate reported rather than gated.

The near-term win is shipping the grammar layer into analyze/review at the recall-leaning bar while the hook stays on the tuned heuristic. That needs no promotion-grade interval. The hook swap waits for a labeled pass with enough power.

Interval width, not point estimates, decides hook promotion. Twenty-four positive flags in a random subset put roughly ±20pp on every metric, which promotes nothing. A power calculation sizes the labeling work to the interval the decision needs (rough target: 3-5x the current positive count). The labeling protocol concentrates new labels where they move the decision (baseline-candidate disagreements and the leader's flags) while keeping a uniform-random anchor for an honest precision estimate.

## Modules

`plugins/writing/linguistics/` is importable by both `hooks/` and `skills/analyze/scripts/`:

- `tags.ts`, `preprocess.ts`, `grammar.ts`, `heading.ts`: pure, no tagger imports, safe for hooks. `heading.ts` exports `classifyHeadingBaseline`, the extracted heading heuristic the hook runs today.
- `tagger.ts` plus `compromise.ts` and `natural.ts`: adapters mapping each tagger into one coarse tag space (`CoarseTag`), so grammar rules are tagger-neutral and the eval isolates tagging quality.
- `classifiers.ts`: eval-only. It imports the tagger adapters, including `natural`, a devDependency the plugin cache omits.

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
- Regenerating per model release turns the corpus into a drift tracker. Vocabulary tells change between models, but the structural detectors should hold across regenerations, and a regression shows up as a recall drop.

Vary the document type (design doc, postmortem, evaluation, rollout plan, capacity plan) so heading styles vary. Evaluate with `--docs`:

```bash
bun skills/analyze/scripts/headings-eval.ts --docs tmp/synthetic-corpus --out tmp/synthetic
```

## Heading Verdict

Applying the two bars to the heading classifiers:

- No candidate clears the hook bar. `hybrid:natural` leads on point estimates (precision at or above baseline, roughly double the recall), but the intervals overlap heavily at 24 random-subset flags, so this is direction, not a verdict. The hook keeps `classifyHeadingBaseline`.
- The grammar layer clears the analyze/review bar: `hybrid:natural`'s recall gain is worth its precision cost where a reviewer triages. This is the near-term ship.
- `natural` stays a devDependency while the hook question is open. The next step is a labeled pass sized by the power calculation, concentrated on `natural`'s flags, before any hook swap.

The hybrid family leads as #744 predicted, keeping the heuristic's structure and replacing only the word sets, but with `natural` doing the tagging rather than the expected `compromise` (see Labeled Sample Results).

## Trope Pattern Inventory

Where each existing detector lands in the layer model, and what moving it would take:

- **Lexical** (`wordlists/*.txt`): stay as word lists. Cheap, the analyze skill audits their health each run, and tagger machinery adds nothing to an exact vocabulary match.
- **Morphosyntactic** (structural regexes in `detection/tropes.ts`): migration candidates, one follow-up issue each, each gated by a wordlist-vs-regex-vs-grammar-vs-judge comparison and the two-surface bars before it is built:
  - passive voice (`COPULA PARTICIPLE` tag sequence vs. the current participle regex)
  - "not X but Y" parallelism (tag-sequence shape vs. literal `not ... but` matching)
  - test-result reporting (function-based test, currently uncountable by the structural audit)
- **Discourse** (cross-sentence negation, escalating triads): structure above the sentence, which part-of-speech tagging alone does not reach. Held until the layer has tooling.
- **Semantic** (marketing tone, hedging density): LLM-judge territory, not grammar.

Per-trope migrations hold until the two-surface bars and the power calculation exist, or each repeats the underpowered-eval mistake. In the meantime the `tropes.ts` regexes ship as hook nudges and stay as-is.

## Dependencies

The tagger fork is now two-way. `wink-pos-tagger` is retired (dominated by `natural`), leaving `compromise` (primary, runtime) and `natural` (devDependency, promotion candidate). The framework resolves the rest: promote `natural` if a powered labeling pass clears it at the hook bar, otherwise collapse to `compromise` only. The analyze/review ship does not force this choice, since the grammar layer surfaces there regardless of which tagger backs it.

| package | role | earns its place by | retired when |
|---|---|---|---|
| `compromise` | primary tagger | powering the heading eval and the part-of-speech-sequence structural signatures in analyze | structural signatures stop producing actionable rules and no classifier is promoted |
| `wink-pos-tagger` | eval comparator | the tagger comparison above | removed after the comparison was recorded (numbers above); it was dominated by `natural` on both precision and recall |
| `natural` | promotion candidate (devDependency) | `hybrid:natural` leads the labeled eval | removed if a larger labeled pass rejects it or promotion lands on another tagger |

`compromise` lives in `dependencies`: the analyze scripts import it at runtime, and distributed plugins run from the plugin cache where `bun` auto-install skips devDependencies. `natural` stays a devDependency (zero session and distribution cost) while the promotion question is open.
