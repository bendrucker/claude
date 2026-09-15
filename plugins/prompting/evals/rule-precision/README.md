# Rule Precision Eval

Scores the `prompting:scan` rules against commits where a human deleted prose from documents a model executes. A rule that flags a line the human went on to cut found a defect someone acted on. A rule that flags lines the human read and kept costs attention on every scan and finds nothing.

```sh
bun plugins/prompting/evals/rule-precision/precision.ts --commit 1ec44ee80 --commit 196bbf000
```

- **Labels**: each `--commit` contributes its own deletions as ground truth. Two commits carry the current labels: [#814](https://github.com/bendrucker/claude/pull/814) `1ec44ee80` stripped filler from every skill in the repo, and [#139](https://github.com/bendrucker/claude/pull/139) `196bbf000` cut skill bodies down to what each run needs. A human read each document and chose the cuts with no rule driving them, which is what makes the deletions usable as labels.
- **Floor**: a rule clears when the lower bound of its 95% interval beats the rate at which the labeled commits deleted prose at all. Flagging lines at random lands at that rate, so clearing it is the minimum for carrying information. `--minPrecision` overrides the measured rate.
- **Counts**: the interval is Wilson, so a rule measured on a dozen hits reports a wide range instead of a number that reads as settled. Below `--minFlagged` hits (default 10) the harness reports `too few to judge` and the rule does not gate the exit code.
- **Candidates**: `--rule 'name=/pattern/flags'` scores a pattern without adding it to the shipping scanner. Repeat the flag to score several. Given any `--rule`, the shipped set is not scored.

## Reading the Numbers

The labels are scoped to what each commit's author was looking for. Both labeling commits were after filler, so they label filler deletions and nothing else. A rule aimed at a different defect class draws almost no hits from them, which is an absence of evidence rather than evidence against the rule. `status-prose`, `ticket-ref`, and `stale-measurement` sit there now. Their evidence is a hand audit of every hit they produce across the repo, not this table.

Precision here is a floor rather than an estimate. The human deleted what they were after in one pass, so a rule can flag a real defect on a line that survived. A rule reading well below its true precision is expected. A rule reading well is hard to fake.

Recall is not measured. Getting it would mean labeling every defect in the pre-image, and the labeling commits only mark the ones their author chose to cut.

## Adding Labels

Strip prose from agent-facing documents in a commit that does nothing else, then pass it as another `--commit`. A commit that mixes prose deletions with feature work labels its feature edits as defects.

## Removal

This harness earns its place by changing what ships. Delete it when two consecutive candidate rules get the same verdict here that the reading pass already reached, because the measurement is then confirming a decision already made. Delete it too if the labels stop growing: with one defect class labeled, every new rule outside that class lands at `too few to judge` and the gate is inert.
