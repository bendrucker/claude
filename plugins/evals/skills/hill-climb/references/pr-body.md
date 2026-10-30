# PR Body

A climb PR lets a reviewer read the verdict and the rows it rests on in one screen. Everything else sits one click away in a collapsed section.

## Layout

- Open with two or three sentences: the failure the traces showed, the instruction that changed, and the verdict.
- Follow with `## Evidence`. Paste the output of `compare.ts --markdown` with a `--row` for each pre-registered target and guard and for `all/with`. It prints those rows first as `Targets and Guards`, then the `Starred` rows, then every full table inside `<details>`. Copy its cells as printed.
- Under the tables, explain in prose each guard that fell, each target that held flat, and each starred row outside the targets and guards, which is a lead and not a result.
- Put cost, latency, or turns beside the scores as their rows from the same output.
- Collapse the `evals:review` report, the result paths pooled into each column, the spend breakdown, and any detail on a rejected sibling candidate, each in its own `<details><summary>…</summary>` with a blank line after the summary so its markdown renders.

## Marks

- **Star.** `*` means only that the cell's permutation p-value fell below the alpha `compare.ts` ran at. Take every star from the script's output. Use no star anywhere else in the body, as emphasis, a footnote, or a rating.
- **Bold.** Bold calls the reader's attention to the cells and phrases the verdict rests on: a starred target, a guard that fell with or without a star, the holdout score, and the verdict word. Bold a whole cell, star included: `**1.00 (p=0.001)\***`. Bold a few cells per table, since a table bolded throughout loses the contrast.

## Accepted Candidate

```markdown
Sessions that ruled out a theory left it out of the body. The session bullet now names an overturned theory in one sentence. **Accepted:** both targets starred up and no guard starred down.

## Evidence

Each cell shows its two-sided permutation p-value against base, and * marks p < 0.1. …

#### Targets and Guards

| measure | row | base | c1 |
| --- | --- | --- | --- |
| Grader pass rate | wrong-turn/with · theory-named | 0.00 | **1.00 (p=0.001)\*** |
| Grader pass rate | wrong-turn/with · intent | 0.17 | **1.00 (p=0.012)\*** |
| Grader pass rate | small-fix/with · self-contained | 0.92 | **0.75 (p=0.180)** |
| Case score | all/with | 0.94 | 0.95 (p=0.640) |
| Cost per run (USD) | all/with | 0.412 | 0.430 (p=0.510) |

#### Starred

| measure | row | base | c1 |
| --- | --- | --- | --- |
| Grader pass rate | wrong-turn/with · theory-named | 0.00 | 1.00 (p=0.001)\* |
| Grader pass rate | wrong-turn/with · intent | 0.17 | 1.00 (p=0.012)\* |

`self-contained` fell without a star. A base-against-base re-run moved it by the same amount, so judge noise explains it.

<details><summary>Case score</summary>

…

</details>

<details><summary>evals:review report</summary>

…

</details>

<details><summary>Columns and spend</summary>

| column | results | runs per case |
| --- | --- | --- |
| base | `results/…-base-r1`, `results/…-base-r2` | 6 a side |
| c1 | `results/…-c1-r1`, `results/…-c1-r2` | 6 a side |

Candidate $43.08. Climb $316.35.

</details>
```

## Closing PR

The climb's closing PR leads with a table of accepted commits, one row each, carrying the starred gain that accepted it. Follow it with the `holdout` comparison from `compare.ts --markdown`, base against final, with `--row` for each holdout tag and arm. Bold the holdout score, and write the gain as a holdout gain only when that row stars.

```markdown
| commit | change | starred gain |
| --- | --- | --- |
| `a1b2c3d` | name an overturned theory | `wrong-turn/with · theory-named` 0.00 → **1.00 (p=0.001)\*** |
| `d4e5f6a` | cap prose words apart from lists | `large-change/with` 0.71 → **0.90 (p=0.040)\*** |
```
