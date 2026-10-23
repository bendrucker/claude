# pydantic-evals

Layout and commands for a suite that evaluates a Python agent with [pydantic-evals](https://ai.pydantic.dev/evals/). Every name below was checked against `pydantic-evals` 2.60. Check a newer install with `help()` before relying on one.

The loop doesn't depend on this repo's TypeScript tooling. Keep the comparison in the suite's own repo, in Python.

## Authoring

- Build a `Dataset(name=..., cases=[...], evaluators=[...])` from `Case(name=..., inputs=..., metadata=..., expected_output=..., evaluators=[...])`. Store it with `dataset.to_file(path, schema_path=None)` and load it with `Dataset.from_file(path)`, so cases live in a reviewable YAML or JSON file.
- Put the split and the request kind in `metadata`, such as `{"split": "dev", "kind": "lookup"}`. Metadata is free-form. Select a split by building a new `Dataset` from the cases whose `metadata["split"]` matches.
- Write each grader as an evaluator returning `bool`, which reports as an assertion, so each run keeps a pass or fail per grader. Subclass `Evaluator` and implement `evaluate(self, ctx: EvaluatorContext) -> bool | EvaluationReason`. `ctx` carries `inputs`, `output`, `expected_output`, and `metadata`. Return `EvaluationReason(value=..., reason=...)` to keep the explanation that error analysis reads. Built-ins such as `Contains` and `Equals` cover fixed patterns.
- Write a judge as `LLMJudge(rubric=..., model=...)`. Put one criterion and the pass bar in `rubric` ("Passes only when every core fact in the expected output is present"). Set `model` explicitly to a model other than the agent's, since the default judge model is a library setting rather than a choice. Leave `assertion` on and `score` off, so the judge reports pass or fail.
- Run the control arm as the same task function with the instruction under test removed, such as the system prompt without the rule or the agent without the tool. Name each arm's report through `evaluate`'s `name`, for example `name="with"` and `name="without"`.

## Running

- Run `dataset.evaluate_sync(task, name=<arm>, repeat=N, max_concurrency=...)` once per replicate, or `await dataset.evaluate(...)` inside async code. `repeat` keeps each repeat as its own row, named `'<case> [1/3]'` with `source_case_name` set, and `report.case_groups()` groups them.
- Launch each replicate as a separate process invocation. Repeats inside one `evaluate` call share that invocation's drift.
- Save each report with `EvaluationReportAdapter.dump_json(report)` from `pydantic_evals.reporting`, one file per arm per replicate. Record the library version and the model per arm in the climb log.

## Comparing

`report.render(baseline=other)` prints a diff table with averages and no significance test, so it cannot star a cell. Compare from the saved reports instead:

1. Read each `ReportCase`'s `assertions`, keyed by evaluator name, whose `value` is the run's pass or fail, and group the runs by `source_case_name`.
2. Pool replicates per column: per case, arm, and grader, concatenate the runs from every report in the column.
3. Run a two-sided permutation test on each cell's pass list against the base column, and star p < 0.1. A cell needs at least 4 runs a side to star.
4. Leave out a run whose task raised (it appears in `report.failures`) and mark its case. A run that hit a provider quota or rate limit is void and gets re-run.

To use another harness's comparison tooling, export the pooled runs to the per-run shape in [../../hill-climb/references/harnesses.md](../../hill-climb/references/harnesses.md).
