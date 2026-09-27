# Climb Notes

The notes file is the climb's single record. A reader who was not in the session reconstructs every decision from it: what was measured, how, what was tried, and why each change was kept or dropped. Write it as the climb runs, never from memory at the end.

## Template

````markdown
# <Target> Performance Climb

<One paragraph: what is being climbed, on which branch, and where accepted changes land.>

## Rules

- Metric: <the number, on the exact scenario, in its unit>.
- Ceiling: <the value past which gains stop mattering>.
- Fast signal: <the proxy used to screen candidates, and the baseline evidence that it tracks the metric>.
- Guard: <the check that proves behavior is unchanged, and how to run it>.
- Side effects: <each thing a run touches and whether it is stubbed, fixed, or reset>.
- Scope: <which changes are allowed>.
- Inputs: `dev` <scenarios>, `holdout` <scenarios>.
- Acceptance: <run count per side, interleaving, test and threshold, guard condition>.
- Stop: <ceiling, three rejections in a row, or budget>.

## Harness

<The command that runs a comparison, where results land, and what was checked before the baseline: build flags, cache state, machine load.>

## Baseline

<Commit, date, machine state. A table of every scenario with median and spread. The A/A noise floor.>

## Profile

<Top entries of the baseline profile and the tool that produced them. Updated after each accept.>

## Candidates

### <Accepted | Rejected>: <short name> (`<commit or patch>`)

Hypothesis: <which profile entry, and why this change should cut it>.

```
before: <pseudocode of the old path>
after:  <pseudocode of the new path>
```

Target: <metric and direction>. Guards: <which>. Guard check: <result>.

| Scenario | base | candidate | change |
| --- | ---: | ---: | ---: |
| <name> | <median> | <median> | <±%> (p=<p>)* |

<One sentence stating the decision and the evidence it rests on.>

## Where It Stands

<Base against final on every scenario, `dev` and `holdout`, starred where significant. The stop reason. Leads left for later.>
````

## Conventions

- Star a cell whose difference clears the acceptance test. An unstarred difference is a tie, however large it looks.
- Keep pseudocode to the lines that changed. A reader should see the idea without opening the diff.
- Link each comparison's raw results (for example `hyperfine --export-json` files) beside the table that summarizes them.
- Record a harness change as its own entry under Harness with the re-run baseline, since every later number rests on it.
