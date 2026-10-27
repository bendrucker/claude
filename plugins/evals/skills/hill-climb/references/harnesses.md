# Other Harnesses

For a Claude API application with no suite yet, `/claude-api build-eval` builds one and `/claude-api hillclimb` climbs it. This file connects a suite that already exists to `compare.ts`.

The loop needs these from any harness:

- A pass or fail per grader per run, kept per run rather than averaged, so runs can pool across invocations.
- A tag per case, for the `dev` and `holdout` split.
- A control arm that runs each case without the artifact. It is the drift check read first in `Compare`.
- A way to load the artifact from a git ref while the cases come from the working tree.
- The final reply per run, for error analysis.

Run the suite with the harness's own command. `compare.ts` reads each stored run through an adapter, which turns it into the native result shape:

```ts
import type { Adapter } from "<repo>/packages/evals/adapter";

/** Reads `runs.json`, one `{ case, arm, run, grader, passed }` row per grader per run. */
const adapter: Adapter = {
  name: "my-harness",
  async read(path) {
    const rows: { case: string; arm: string; run: number; grader: string; passed: boolean }[] =
      await Bun.file(path).json();
    const cases = new Map<string, Record<string, { graders: { name: string; passed: boolean }[] }[]>>();
    for (const r of rows) {
      const arms = cases.get(r.case) ?? {};
      const runs = (arms[r.arm] ??= []);
      (runs[r.run] ??= { graders: [] }).graders.push({ name: r.grader, passed: r.passed });
      cases.set(r.case, arms);
    }
    const result = { cases: [...cases].map(([name, arms]) => ({ name, arms })) };
    return { result, measured: new Map() };
  },
};
export default adapter;
```

`read` gets one result path as passed on the command line and returns `{ result, measured }`. `result.cases[].arms[arm]` holds one entry per run, each with its `graders` and an optional `score`. A run without a `score` stays out of the case-score rows and still counts in the grader rows. `scored: false` marks an indicator such as a skill-fired check. `measured` maps `<case>/<arm>` to per-run `{ words, turns, seconds, tokens, cost }`, and a run left out has no measures. An optional `label(path)` names a column when `--label` is absent.

```bash
bun evals/native/compare.ts --adapter ./my-adapter.ts --suite <suite> <base1>,<base2> <cand1>,<cand2>
```

Bun loads the `.ts` module directly, without a build step. Record the adapter path in the climb log beside the harness version. Re-score with the harness's own tooling and read the result back through the adapter.

A harness that would rather emit native files can call `writeResult` from `packages/evals/result.ts`, which writes `aggregate-result.json` and a trace per run and scores each run the way the runner does. Pass `--suite` only when the cases live in `<suite>/<case>/case.yaml` with a `tags` list.

## Agent SDKs and Other CLIs

Run each case twice, with and without the instruction in the system prompt or tool set, and grade the reply with the same regex and single-criterion judge rules. Store each invocation's runs and read them through an adapter.
