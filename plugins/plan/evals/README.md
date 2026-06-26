# Plan Guidance A/B

Measures whether a candidate guidance idea produces better implementation plans than the baseline plan guidelines alone. The harness compares the baseline against the baseline plus a candidate snippet, so an idea can be tested without editing [`../references/guidelines.md`](../references/guidelines.md).

## How It Works

[`ab.ts`](ab.ts) runs each fixture in [`fixtures/`](fixtures/) through `claude -p` under two conditions:

- **control**: the baseline guidelines from [`../references/guidelines.md`](../references/guidelines.md).
- **treatment**: the baseline with the candidate snippet (`--candidate`, default [`candidates/alternatives-section.md`](candidates/alternatives-section.md)) appended.

Each fixture runs `--reps` times (default 5) so per-generation noise averages out. For each rep the harness generates a control plan and a treatment plan, then a judge pass ([`judge.md`](judge.md)) compares the two head-to-head and picks the better plan on four qualities, plus an overall verdict:

- **right-sized detail**: confirms direction before committing to file lists, signatures, or test cases.
- **outcome-focused**: states the goal and the verifiable end state it drives toward.
- **scope discipline**: names what it is not doing and defers non-essential work.
- **grounded**: refers to the actual code and constraints it was given, without inventing structure.

Each quality is won by control, won by treatment, or tied. The overall verdict is the judge's holistic preference, not a tally. Which plan the judge sees first alternates by fixture and rep to counterbalance position bias, and the verdict is mapped back to control/treatment.

## The Metric

The headline is **treatment's win rate**: treatment wins as a share of decisive (non-tie) comparisons, reported per quality and overall with a Wilson 95% interval. Fifty percent means the candidate changed nothing. The verdict line reads `treatment wins` when the overall interval clears 50%, `control wins` when it falls below, and `no decision` when it spans 50%.

## Candidates

A candidate is a markdown snippet under [`candidates/`](candidates/) that the harness appends to the baseline to form the treatment. To test a new idea, write a snippet, run `ab.ts --candidate candidates/<name>.md`, and read the delta. The baseline guidelines stay untouched until an idea earns its place.

[`candidates/alternatives-section.md`](candidates/alternatives-section.md) is the first idea tested. It adds an optional `## Alternatives` section for declined roads. It did not earn its place. An early run leaned positive (overall treatment near 62%, scope discipline pinned at treatment), but the lean tracked the candidate's extra section rather than better plans: once the judge was hardened to disregard length and section form, scope discipline collapsed toward 50% and the overall win rate landed around 54.8% [37.8–70.8], an interval spanning 50%. That run was also truncated by a spend limit (n=31), so the number is soft, but the de-confounded signal is null-to-marginal. The candidate did not ship. The harness stays, to test the next one.

## Measurability

The first cut of this harness produced a confounded result for reasons that had nothing to do with the candidate. Two fixture design choices address them:

#### Isolation

Generation runs in an empty temp directory with an explicit greenfield framing. The grounding rules in the guidelines tell the model to read the code before planning. Pointed at a real repo that lacks the fictional app a fixture describes, the model refuses the task instead of planning. The empty cwd and greenfield framing remove that basis for both conditions equally. Each fixture carries its own embedded codebase context (a file tree and a snippet or two) so the **grounded** quality has real structure to check against.

#### Discrimination

Each fixture embeds a genuine direction fork and an explicit scope boundary, so the qualities have something to separate the plans on. A fixture that pre-rejects an alternative in so many words, or that names no boundary, leaves both plans equivalent and the judge ties every comparison. The fork is implied by the situation, not handed over as finished prose.

## Running

```
bun plugins/plan/evals/ab.ts
```

Cost is `fixtures x reps x 3` calls to `claude -p`, two plan generations and one judgment per rep (8 fixtures, 5 reps default = 120 calls). Flags: `--candidate` to test a different snippet, `--reps` to trade cost for tighter intervals, `--model` to pin the model, `--concurrency` for parallelism (default 4, kept low to avoid server-side rate limiting), `--fixtures`/`--guidelines` to point elsewhere, `--out` for the artifact directory. Generated plans and judge results land in `tmp/ab/`.

A run that drops units (a generation or judgment that exhausts its retries) prints a prominent warning. Dropped units are not a random sample, so the win rate over the survivors can be biased. Re-run or raise `--reps` before trusting a verdict from a run that lost units.

This is local and manual. The CI-safe coverage is the pure-helper unit tests ([`ab.test.ts`](ab.test.ts)) and the scanner tests under [`../scripts/`](../scripts/).

## Reading the Result

The **delta** between conditions is the signal. If treatment's interval contains 50%, the candidate changed nothing measurable. Treatment's interval clearing 50% is evidence the candidate earns its place in the guidelines.

Absolute rates depend on the judge model and these synthetic fixtures, so treat them as relative. The reusable artifact is the harness: swap `--candidate` to see whether a new wording helps or hurts.
