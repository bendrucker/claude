# Linguistic Tooling

Record of evaluating part-of-speech-tagger-backed detectors for the writing hook and skills, and the rules for shipping one. The heading classifier is the first detector evaluated here.

Numbers are aggregates over private session corpora. Example headings are invented, never quoted from sessions.

## Detector Layers

A writing check belongs to one of four layers, and the layer decides the right tool before any code is written:

- **Vocabulary** (`delve`, `boasts`, "it's worth noting"): a wordlist. Linguistics adds nothing here. The analyze skill already measures word frequency and lift.
- **Grammar** (sentence-shaped headings, passive voice, "not X but Y"): patterns over part-of-speech sequences that a wordlist cannot express and a plain regex gets wrong. The only layer a tagger helps with.
- **Cross-sentence** (negation flips, escalating triads): structure spanning sentences, which a tagger alone cannot see.
- **Meaning** (vacuous specificity, motivation absence, marketing tone, hedging density): no grammar captures it. The LLM judge's layer (`skills/analyze/scripts/judge.ts`, batch-only). See the "Meaning-Layer Judge" section of `methodology.md`.

Before building a grammar rule, check whether a wordlist, a regex, or an LLM judge does the job as well. The tagger is not the default.

## Promotion Bars

The same engine feeds two surfaces with opposite tolerances, so a detector clears one bar or two:

- **The hook** nudges on every edit. Frequent false positives train the user to ignore it, so it is precision-critical. A detector replaces a hook check only when, on a labeled sample with a tight enough interval, it shows precision at least as high as the current check, higher recall, and no regressions on the committed seed (`linguistics/heading.test.ts`).
- **The analyze and review skills** run in batches a person reviews. A reviewer triages flags, so recall matters more than precision. A detector too noisy for the hook can still ship here; track its false-positive rate rather than gating on it.

Hook promotion turns on interval width. A sample with few positives carries intervals too wide to act on. Size the labeling pass with the power calculation, concentrate new labels on disagreements and the leading candidate's flags, and keep a uniform-random slice for an honest precision estimate.

## Modules

`plugins/writing/linguistics/` is importable by both `hooks/` and `skills/analyze/scripts/`:

- `tags.ts`, `preprocess.ts`, `grammar.ts`, `heading.ts`: pure, no tagger imports, safe for hooks. `heading.ts` exports `classifyHeadingBaseline`, the heuristic the hook runs today.
- `tagger.ts`, `compromise.ts`, `natural.ts`: adapters mapping each tagger to one coarse tag set, so grammar rules stay tagger-neutral.
- `classifiers.ts`: eval-only. It imports the tagger adapters, including `natural`, a devDependency the plugin cache omits.

Hooks must never import a tagger adapter. The plugin cache skips devDependencies, so a hook importing one works locally and breaks for every install.

## Tagger Failures

Naive tagging fails on terse, title-cased headings two ways:

- Title case biases taggers toward proper nouns. In "Latency Is the Main Bottleneck", `Is` reads as part of a name and the verb disappears.
- Lowercasing first swings the bias the other way. "Changes" reads as a verb, flagging about 45% of headings where the tuned heuristic flags about 4%.

The adapters handle the first by recognizing the eight finite forms of "be" (`is am are was were 's 're 'm`) directly, regardless of tagger output. The second is positional: a verb counts as clause evidence only with a subject in front of it, never as the whole heading, and modifier participles ("a leaked key") are skipped.

## Classifier Comparison

Three candidates, each run on each tagger:

- `finite-verb`: flag a verb with a subject in front. Misses imperatives by design.
- `np-test`: flag when the heading fails a noun-phrase parse and shows a verb. The most aggressive.
- `hybrid`: the heuristic's structural rules with tagger judgment replacing its hand-maintained word sets.

Flag rates on the session corpus (2,858 unique headings):

| classifier | flags | flag rate | baseline agreement |
|---|---|---|---|
| baseline | 151 | 5.3% | 100% |
| finite-verb:compromise | 418 | 14.6% | 86.6% |
| np-test:compromise | 946 | 33.1% | 71.1% |
| hybrid:compromise | 532 | 18.6% | 84.6% |
| finite-verb:natural | 252 | 8.8% | 91.8% |
| np-test:natural | 688 | 24.1% | 79.7% |
| hybrid:natural | 324 | 11.3% | 91.4% |

A higher flag rate is neither good nor bad on its own: the candidate could be catching real clauses or inventing them. The labeled sample settles it.

## Labeled Results

A 499-row sample (200 disagreement-biased rows, 299 uniform-random), labeled by grammatical form (367 noun-phrase, 66 imperative, 29 fragment, 23 clause, 15 interrogative). Precision and recall on the random subset, counting `clause` and `imperative` as should-flag:

| classifier | precision | 95% CI | recall |
|---|---|---|---|
| baseline | 76.9% | 49.7..91.8 | 20.8% |
| finite-verb:compromise | 41.4% | 25.5..59.3 | 25.0% |
| np-test:compromise | 41.0% | 30.8..52.1 | 66.7% |
| hybrid:compromise | 57.1% | 42.2..70.9 | 50.0% |
| finite-verb:natural | 70.6% | 46.9..86.7 | 25.0% |
| np-test:natural | 45.2% | 33.4..57.5 | 58.3% |
| hybrid:natural | 79.2% | 59.5..90.8 | 39.6% |

- The baseline is precise but misses four of five real sentence headings, mostly imperatives outside its opener word set.
- `hybrid:natural` is the only candidate that beats the baseline on both, with precision at or above it and roughly double the recall. The intervals overlap heavily (24 flags), so this points a direction without settling it.
- `hybrid:compromise` loses on precision: compromise reads terse title-case tokens as verbs more readily than natural, producing more false positives. The more conservative tagger wins.
- The `np-test` family buys recall (58-71%) at a precision too low to use (40-45%).

Nothing is promoted on these numbers. A larger labeled pass on the leader's flags comes next, weighed against package size: a hook tagger ships to every install, and `natural` is far heavier than `compromise`.

## Eval Harness

`skills/analyze/scripts/headings-eval.ts` extracts headings the same way the hook does, dedupes them, and runs every classifier:

```bash
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH"
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH" --sample 300   # emit labeling file
bun skills/analyze/scripts/headings-eval.ts --session-db "$DB_PATH" --labels tmp/heading-labels.tsv
```

`--sample` writes a labeling file: all baseline-candidate disagreements (capped) plus a uniform-random sample. `--labels` scores both subsets with Wilson 95% intervals. Labels are `noun-phrase`, `clause`, `imperative`, `interrogative`, and `fragment`; `clause` and `imperative` should flag. Corpus artifacts stay in `tmp/` and never leave the machine.

## Synthetic Corpus

The session corpus is private and cannot be committed, so it measures precision but cannot serve as a regression gate. Generate a corpus safe to commit (model output, never from a session):

```bash
claude -p --no-session-persistence --setting-sources project \
  "Write a technical design document, roughly 1000 words, in markdown with section headings, for <topic>." \
  > tmp/synthetic-corpus/<slug>.md
```

- `--no-session-persistence` keeps generation out of the session index.
- `--setting-sources project` from a scratch directory drops the user's writing instructions, so the output is the model's untreated style.
- Regenerating per model release makes it a drift tracker: vocabulary changes between models, but the grammar detectors should hold, and a regression shows up as a recall drop.

Vary the document type (design doc, postmortem, rollout plan) so heading styles vary, then evaluate with `--docs`:

```bash
bun skills/analyze/scripts/headings-eval.ts --docs tmp/synthetic-corpus --out tmp/synthetic
```

Ten generated documents produced 114 headings, none of them real sentence headings, so the synthetic corpus measures false positives. With no real positives in the sample, it says nothing about recall. The baseline flagged none. Candidates produced 1-15 each, all on conventional shapes now committed as regression fixtures:

- Numbered headings ("3.1 Unit Tests"): a plural head noun reads as a verb with the number as its subject.
- Trailing participles ("Lessons Learned"): the participle fails the noun-phrase parse.
- Colon-prefixed noun phrases ("Testing Strategy: Payments Reconciliation Service").

## Judge Reference Baseline

The upper-reference run this eval calls for: the same LLM judge that scores the meaning layer, pointed at headings with one question ("is this heading sentence-shaped?", `resources/judge/headings-prompt.md`). If a cheap judge ties the tagger stack on a trope, that trope does not belong in the grammar layer.

```bash
bun skills/analyze/scripts/judge-run.ts headings tmp/heading-labels.tsv
```

The runner scores the judge against the existing labels with the same Wilson protocol and prints the full-set and random-subset aggregates. The comparison has not run yet (it needs an API key and the labeled file, and sits behind the #791 calibration checkpoint). Record the resulting aggregate here, next to the classifier table, when it runs.

## Verdict

- No candidate clears the hook bar. `hybrid:natural` leads, but the intervals are too wide to act on, so the hook keeps `classifyHeadingBaseline`.
- The grammar layer clears the analyze and review bar, where the recall gain is worth the precision cost. That is where it ships now.
- `natural` stays a devDependency until a larger labeled pass settles whether it earns a place in the hook.

## Trope Inventory

Where each existing detector sits, and what moving it would take:

- **Vocabulary** (`wordlists/*.txt`): stay as wordlists. The analyze skill audits them each run.
- **Grammar** (regexes in `detection/tropes.ts`): candidates for a tagger rule, each only after the layer check confirms a tagger beats a regex. Passive voice, "not X but Y", and test-result reporting are the current candidates.
- **Cross-sentence** (negation flips, question cadence, consequence chains, tricolon): batch-surface detectors in `detection/tropes.ts`, plus the tagger-backed tricolon in `linguistics/tricolon.ts` behind the hook wall. Thresholds are literature heuristics until the #769 labeling pass calibrates them. A corpus comparison retired burstiness and discourse-marker density: neither separates agent-era prose from the pre-AI baseline, and discourse markers run lower in agent prose than in the baseline. The subordinate:coordinate ratio and negative-contrast rate replace them as rate features in `voice-delta.ts`.
- **Meaning** (vacuous specificity, motivation absence, marketing tone, hedging): the batch judge (`judge.ts`) covers this layer in analyze, pending calibration (#791). Hooks never run it.

Until the bars and the power calculation are in place, the `tropes.ts` regexes stay as they are and ship as hook nudges.

## Dependencies

`compromise` is the runtime tagger. `natural` is a devDependency under evaluation as a hook tagger. An earlier comparator, `wink-pos-tagger`, was dropped after `natural` beat it on precision and recall. The open choice is to promote `natural` if a powered labeling pass clears it at the hook bar, or drop it for `compromise` alone; either way the analyze and review surfaces work unchanged.

| package | role | earns its place by | retired when |
|---|---|---|---|
| `compromise` | runtime tagger | powering the heading eval and the part-of-speech structural signatures in analyze | structural signatures stop producing rules and no classifier is promoted |
| `natural` | hook tagger candidate (devDependency) | leading the labeled eval | a larger labeled pass rejects it, or promotion lands elsewhere |

`compromise` lives in `dependencies` because the analyze scripts import it at runtime and the plugin cache skips devDependencies. `natural` stays a devDependency while its promotion is open.
