import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import type { Adapter, Transcript } from "../../../../../../../packages/evals/adapter";

const ARMS: Record<string, string> = {
  "with-system-prompt": "with",
  "no-system-prompt": "without",
};

const Assertion = z.looseObject({ type: z.string(), value: z.unknown(), metric: z.string() });
const Row = z.looseObject({
  testIdx: z.number(),
  promptIdx: z.number(),
  testCase: z.object({ description: z.string() }),
  response: z.object({ output: z.string() }),
  gradingResult: z.looseObject({
    componentResults: z.array(z.looseObject({ pass: z.boolean(), assertion: Assertion })),
  }),
});
const Output = z.looseObject({
  results: z.looseObject({
    prompts: z.array(z.object({ label: z.string() })),
    results: z.array(Row),
  }),
});
const Config = z.object({
  tests: z.array(
    z.object({
      description: z.string(),
      metadata: z.object({ tags: z.array(z.string()) }),
      assert: z.array(Assertion),
    }),
  ),
});

async function load(path: string) {
  return ordered(Output.parse(await Bun.file(path).json()));
}

/** Runs in promptfoo's order, each with the arm its prompt label stands for. */
function ordered({ results }: z.output<typeof Output>) {
  return results.results
    .toSorted((a, b) =>
      a.testIdx === b.testIdx ? a.promptIdx - b.promptIdx : a.testIdx - b.testIdx,
    )
    .map((row) => {
      const label = results.prompts[row.promptIdx]?.label ?? "";
      const arm = ARMS[label];
      if (arm === undefined) throw new Error(`unknown prompt label: ${label}`);
      return { row, arm, name: row.testCase.description };
    });
}

async function config(dir: string) {
  return Config.parse(Bun.YAML.parse(await Bun.file(join(dir, "promptfooconfig.yaml")).text()));
}

export const adapter: Adapter = {
  name: "promptfoo",

  async run(suite, { ref, label, args }) {
    const dir = await mkdtemp(join(tmpdir(), "promptfoo-run-"));
    await $`cp -R ${suite}/. ${dir}`.quiet();
    await rm(join(dir, ".git"), { recursive: true, force: true });
    if (ref !== undefined) {
      const prompt = await $`git show ${ref}:prompt.txt`.cwd(suite).text();
      await Bun.write(join(dir, "prompt.txt"), prompt);
    }
    const output = join(dir, label === undefined ? "results.json" : `results-${label}.json`);
    const { exitCode } =
      await $`promptfoo eval --no-cache --no-share --no-write --output ${output} ${args}`
        .cwd(dir)
        .env({ ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1" })
        .nothrow();
    // Exit code 100 means some assertion failed.
    if (exitCode !== 0 && exitCode !== 100) throw new Error(`promptfoo exited ${exitCode}`);
    return output;
  },

  async read(path) {
    const cases = new Map<
      string,
      Record<string, { graders: { name: string; passed: boolean }[] }[]>
    >();
    for (const { row, arm, name } of await load(path)) {
      const arms = cases.get(name) ?? {};
      (arms[arm] ??= []).push({
        graders: row.gradingResult.componentResults.map((c) => ({
          name: c.assertion.metric,
          passed: c.pass,
        })),
      });
      cases.set(name, arms);
    }
    return {
      result: { cases: [...cases].map(([name, arms]) => ({ name, arms })) },
      measured: new Map(),
    };
  },

  async tags(suite) {
    return new Map((await config(suite)).tests.map((t) => [t.description, t.metadata.tags]));
  },

  async rescore(suite, path) {
    const { tests } = await config(suite);
    const output = Output.parse(await Bun.file(path).json());
    const stored = ordered(output);
    const dir = await mkdtemp(join(tmpdir(), "promptfoo-regrade-"));
    // promptfoo's echo provider replays logged outputs, so the current assertions grade them without a model.
    const regrade = {
      prompts: ["{{logged_output}}"],
      providers: ["echo"],
      tests: stored.map(({ row, name }) => ({
        description: name,
        vars: { logged_output: row.response.output },
        assert: tests.find((t) => t.description === name)?.assert ?? [],
      })),
    };
    await Bun.write(join(dir, "regrade.json"), JSON.stringify(regrade));
    const { exitCode } =
      await $`promptfoo eval -c regrade.json --no-cache --no-share --no-write --output regraded.json`
        .cwd(dir)
        .env({ ...process.env, PROMPTFOO_DISABLE_TELEMETRY: "1" })
        .nothrow();
    if (exitCode !== 0 && exitCode !== 100) throw new Error(`promptfoo exited ${exitCode}`);
    const { results } = Output.parse(await Bun.file(join(dir, "regraded.json")).json());
    const after = results.results.toSorted((a, b) => a.testIdx - b.testIdx);
    const seen = new Map<string, number>();
    const flips = stored.flatMap(({ row, arm, name }, i) => {
      const key = `${name}/${arm}`;
      const run = seen.get(key) ?? 0;
      seen.set(key, run + 1);
      return row.gradingResult.componentResults.flatMap((before) => {
        const passed = after[i]?.gradingResult.componentResults.find(
          (c) => c.assertion.metric === before.assertion.metric,
        )?.pass;
        if (passed === undefined || passed === before.pass) return [];
        before.pass = passed;
        return [{ grader: `${name}/${before.assertion.metric}`, run: `${arm}/${run}`, passed }];
      });
    });
    const regraded = join(dir, "results.json");
    await Bun.write(regraded, JSON.stringify(output));
    return { path: regraded, flips };
  },

  async traces(path) {
    const traces = new Map<string, Transcript[]>();
    for (const { row, arm, name } of await load(path)) {
      const key = `${name}/${arm}`;
      traces.set(key, [...(traces.get(key) ?? []), { reply: row.response.output, calls: [] }]);
    }
    return traces;
  },
};

export default adapter;
