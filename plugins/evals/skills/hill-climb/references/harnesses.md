# Other Harnesses

This file connects a suite that already exists to the loop.

The loop drives every harness through one adapter: a TypeScript module implementing `Adapter` from `packages/evals/adapter.ts`. `native` is built in. For any other harness, read its docs and one stored run, then write the adapter beside the climb log before the first run, so every column runs and reads through the same file. A suite that already ships an adapter names it in its `README.md`. Use that one.

## Operations

- `run(suite, { ref, label, args })` runs every case twice, with and without the artifact, reading the artifact at `ref` while the cases come from the working tree. It stores a pass or fail per grader per run, kept per run so runs pool across invocations, and returns the stored result's path. `args` pass through to the harness.
- `read(path)` turns one stored result into `{ result, measured }`. `result.cases[].arms[arm]` holds one entry per run, each with its `graders` and an optional `score`. A run without a `score` stays out of the case-score rows and still counts in the grader rows. `scored: false` marks an indicator such as a skill-fired check. `measured` maps `<case>/<arm>` to per-run `{ words, turns, seconds, tokens, cost }`, and a run left out has no measures.
- `tags(suite)` maps each case to its tags, which carry the `dev` and `holdout` split.
- `rescore(suite, path)` re-scores a stored result under the suite's current graders without new sessions. It returns the re-scored result's path and each changed verdict as `{ grader, run, passed }`.
- `traces(path)` maps each `<case>/<arm>` to its runs' `{ reply, calls }`, for error analysis and for counting the runs that opened a reference. `calls` holds each tool call as `<tool> <target>`.
- `label(path)`, optional, names a column when `--label` is absent.

An operation the harness can't perform throws with the reason, and the climb log records the gap.

When the harness needs secrets behind an approval prompt, resolve them once per batch: wrap the driver that launches every invocation in the secret tool rather than each invocation. A per-invocation prompt stalls a queued run until a person answers it.

## Example

A harness whose `my-evals run --out <dir>` writes `runs.json`, one `{ case, arm, run, grader, passed, reply }` row per grader per run, with tags in `cases.json`:

```ts
import { join } from "node:path";
import { $ } from "bun";
import type { Adapter } from "<repo>/packages/evals/adapter";

interface Row { case: string; arm: string; run: number; grader: string; passed: boolean; reply: string }
const rows = (path: string): Promise<Row[]> => Bun.file(path).json();

const adapter: Adapter = {
  name: "my-evals",
  async run(suite, { ref, label, args }) {
    const out = join(suite, "results", label ?? ref ?? "working");
    await $`my-evals run ${suite} --artifact-ref ${ref ?? "HEAD"} --out ${out} ${args}`;
    return join(out, "runs.json");
  },
  async read(path) {
    const cases = new Map<string, Record<string, { graders: { name: string; passed: boolean }[] }[]>>();
    for (const r of await rows(path)) {
      const arms = cases.get(r.case) ?? {};
      ((arms[r.arm] ??= [])[r.run] ??= { graders: [] }).graders.push({ name: r.grader, passed: r.passed });
      cases.set(r.case, arms);
    }
    return { result: { cases: [...cases].map(([name, arms]) => ({ name, arms })) }, measured: new Map() };
  },
  async tags(suite) {
    return new Map(Object.entries(await Bun.file(join(suite, "cases.json")).json()));
  },
  async rescore() {
    throw new Error("my-evals grades only while running");
  },
  async traces(path) {
    const cells = new Map<string, { reply: string; calls: string[] }[]>();
    for (const r of await rows(path)) {
      const runs = cells.get(`${r.case}/${r.arm}`) ?? [];
      runs[r.run] = { reply: r.reply, calls: [] };
      cells.set(`${r.case}/${r.arm}`, runs);
    }
    return cells;
  },
};
export default adapter;
```

Every command takes the module:

```bash
bun evals/native/run.ts --adapter ./my-adapter.ts <suite> --ref <base> -- <harness args>
bun evals/native/compare.ts --adapter ./my-adapter.ts --suite <suite> <base1>,<base2> <cand1>,<cand2>
bun evals/native/regrade.ts --adapter ./my-adapter.ts <suite> <result>
bun evals/native/calls.ts --adapter ./my-adapter.ts --match 'Read .*references/' <result>
```

Bun loads the `.ts` module directly, without a build step. Before reading any comparison, check the adapter against the harness: compare one column alone and match its pass counts for a few cases to the harness's own report. A mismatch means the adapter misread the format. Record the adapter path in the climb log beside the harness version, and keep the file unchanged for the rest of the climb, since an edit can move every column it reads.

A harness that would rather emit native files can call `writeResult` from `packages/evals/result.ts`, which writes `aggregate-result.json` and a trace per run and scores each run the way the runner does, and then read through `native`.

## Agent SDKs and Other CLIs

The adapter's `run` invokes the SDK or CLI once per case and arm, with and without the instruction in the system prompt or tool set, and grades the reply with the same regex and single-criterion judge rules.
