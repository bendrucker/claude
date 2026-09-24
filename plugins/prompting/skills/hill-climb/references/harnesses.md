# Other Harnesses

The loop needs these from any harness:

- A pass or fail per grader per run, kept per run rather than averaged, so runs can pool across invocations.
- A tag per case, for the `dev` and `holdout` split.
- A control arm that runs each case without the artifact. It is the drift check read first in `Compare`.
- A way to load the artifact from a git ref while the cases come from the working tree.
- The final reply per run, for error analysis.

`compare.ts` reads the native `aggregate-result.json` shape. To compare another harness's runs, write one file per invocation in that shape and pass the files as columns:

```json
{
  "cases": [
    {
      "name": "<case>",
      "arms": {
        "with": [{ "score": 0.75, "graders": [{ "name": "<grader>", "passed": true, "scored": true }] }],
        "without": [{ "score": 0.5, "graders": [] }]
      }
    }
  ]
}
```

`score` is the run's weighted grader mean. `scored: false` marks an indicator such as a skill-fired check. A reply for the word counts goes in `traces/<case>-<arm>-<n>.jsonl` beside the file, as a final `{"type": "result", "result": "<reply>"}` line. Pass `--suite` only when the cases live in `<suite>/<case>/case.yaml` with a `tags` list.

## promptfoo

- Repeat runs with `--repeat <n>`.
- Tag cases in test `metadata` and select a split with `--filter-metadata split=dev`.
- Add the control arm as a second provider that loads no plugin.
- Stage the artifact at a ref with `git archive <ref> -- <paths> | tar -x -C <dir>` and point the provider at `<dir>`.
- Convert `promptfoo export` output: each result row's `gradingResult.componentResults` becomes a run's `graders`, and the provider label picks the arm.

## Agent SDKs and Other CLIs

Run each case twice, with and without the instruction in the system prompt or tool set, and grade the reply with the same regex and single-criterion judge rules. Write each invocation's runs in the shape above.
