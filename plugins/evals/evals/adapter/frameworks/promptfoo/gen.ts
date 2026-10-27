// Records the seen and held runs with the real promptfoo, then derives each truth.json from them.
// Usage: bun gen.ts
// Under a sandbox, `bunx` needs registry.npmjs.org.
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import { countsDiffer, type Truth, truthCounts } from "../../scripts/truth";

const VERSION = "0.125.1";
const LABELS: Record<string, string> = {
  "with-system-prompt": "with",
  "no-system-prompt": "without",
};
/** Seeds `provider.js` mixes into which replies lose their answer. */
const SEEDS = { seen: "0", held: "3" } as const;

const here = import.meta.dirname;
const scratch = join(tmpdir(), "promptfoo-gen");

const Assertion = z.looseObject({ metric: z.string() });
const Row = z.object({
  testIdx: z.number(),
  promptIdx: z.number(),
  testCase: z.object({
    description: z.string(),
    metadata: z.looseObject({ tags: z.array(z.string()).default([]) }).default({ tags: [] }),
  }),
  response: z.object({ output: z.string() }),
  gradingResult: z.object({
    componentResults: z.array(z.object({ pass: z.boolean(), assertion: Assertion })),
  }),
});
const Output = z.object({
  results: z.object({
    prompts: z.array(z.object({ label: z.string() })),
    results: z.array(Row),
  }),
});
type Output = z.output<typeof Output>;

const Config = z.object({
  tests: z.array(z.object({ description: z.string(), assert: z.array(Assertion) })),
});

const env = {
  ...process.env,
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  PROMPTFOO_DISABLE_SHARING: "1",
};

async function project(name: string): Promise<string> {
  await mkdir(scratch, { recursive: true });
  const dest = join(await mkdtemp(join(scratch, `${name}-`)), "project");
  await $`bash ${join(here, "setup.sh")} ${dest}`.quiet();
  return dest;
}

async function evaluate(dir: string, extra: Record<string, string>, ...args: string[]) {
  const { exitCode, stderr } =
    await $`bunx promptfoo@${VERSION} eval --no-cache --no-share --no-write ${args}`
      .cwd(dir)
      .env({ ...env, ...extra })
      .quiet()
      .nothrow();
  // Exit code 100 means some assertion failed, which the stub provider arranges.
  if (exitCode !== 0 && exitCode !== 100)
    throw new Error(`promptfoo exited ${exitCode}: ${stderr.toString()}`);
}

async function record(name: keyof typeof SEEDS) {
  const dir = await project(name);
  await evaluate(dir, { STUB_SEED: SEEDS[name] }, "--output", "results.json");
  // The scratch path leaks into file-backed vars, so the stored run names the project instead.
  const text = (await Bun.file(join(dir, "results.json")).text()).replaceAll(dir, "/project");
  await Bun.write(
    join(here, "fixtures", name, "results.json"),
    `${JSON.stringify(JSON.parse(text), null, 2)}\n`,
  );
}

/** Each verdict set in the order promptfoo executed the runs. */
function verdicts(output: Output) {
  return output.results.results
    .toSorted((a, b) =>
      a.testIdx === b.testIdx ? a.promptIdx - b.promptIdx : a.testIdx - b.testIdx,
    )
    .map((row) => ({
      row,
      graders: Object.fromEntries(
        row.gradingResult.componentResults.map((c) => [c.assertion.metric, c.pass]),
      ),
    }));
}

/** The runs in execution order, each with its arm and its index within that case and arm. */
function runs(output: Output) {
  const counts = new Map<string, number>();
  return verdicts(output).map(({ row, graders }) => {
    const label = output.results.prompts[row.promptIdx]?.label ?? "";
    const arm = LABELS[label];
    if (arm === undefined) throw new Error(`unmapped prompt label: ${label}`);
    const key = `${row.testCase.description}/${arm}`;
    const index = counts.get(key) ?? 0;
    counts.set(key, index + 1);
    return { row, arm, index, graders };
  });
}

function truth(output: Output, rescore: Truth["rescore"]) {
  const cases: Truth["cases"] = {};
  for (const { row, arm, graders } of runs(output)) {
    const entry = (cases[row.testCase.description] ??= {
      tags: row.testCase.metadata.tags,
      arms: {},
    });
    (entry.arms[arm] ??= []).push({ graders, reply: row.response.output });
  }
  return { result: "results.json", labels: LABELS, cases, rescore };
}

/** Edits one assertion in a project copy and returns the patch `git apply` takes. */
async function patch(dir: string): Promise<string> {
  const file = join(dir, "promptfooconfig.yaml");
  const text = await Bun.file(file).text();
  const edited = text.replace("value: Shakespeare", "value: William Shakespeare");
  if (edited === text) throw new Error("the rescore edit matched nothing");
  await Bun.write(file, edited);
  return $`git diff`.cwd(dir).text();
}

/**
 * Re-grades stored outputs under the project's current assertions through promptfoo's documented
 * path for logged outputs: the echo provider returns each stored reply as the prompt.
 */
async function flips(dir: string, stored: Output) {
  const config = Config.parse(
    Bun.YAML.parse(await Bun.file(join(dir, "promptfooconfig.yaml")).text()),
  );
  const before = runs(stored);
  const tests = before.map(({ row }) => ({
    description: row.testCase.description,
    vars: { logged_output: row.response.output },
    assert: config.tests.find((t) => t.description === row.testCase.description)?.assert,
  }));
  const regrade = { prompts: ["{{logged_output}}"], providers: ["echo"], tests };
  await Bun.write(join(dir, "regrade.json"), JSON.stringify(regrade));
  await evaluate(dir, {}, "-c", "regrade.json", "--output", "regraded.json");
  const after = verdicts(Output.parse(await Bun.file(join(dir, "regraded.json")).json()));
  return before.flatMap((b, i) =>
    Object.entries(b.graders)
      .filter(([metric, passed]) => after[i]?.graders[metric] !== passed)
      .map(([grader]) => ({ case: b.row.testCase.description, arm: b.arm, run: b.index, grader })),
  );
}

await record("seen");
await record("held");
const read = async (name: string) =>
  Output.parse(await Bun.file(join(here, "fixtures", name, "results.json")).json());
const [seen, held] = [await read("seen"), await read("held")];

const pending: Truth["rescore"] = { supported: false, reason: "" };
if (
  countsDiffer(truthCounts(truth(seen, pending)), truthCounts(truth(held, pending))) === undefined
)
  throw new Error("seen and held pass counts are identical");

const edited = await project("rescore");
const patchText = await patch(edited);
const [seenFlips, heldFlips] = [await flips(edited, seen), await flips(edited, held)];
if (heldFlips.length === 0) throw new Error("the rescore edit flips no held verdict");

await Bun.write(join(here, "fixtures/held/rescore.patch"), patchText);
const files = [
  ["seen", seen, seenFlips],
  ["held", held, heldFlips],
] as const;
await Promise.all(
  files.map(([name, output, changed]) =>
    Bun.write(
      join(here, "fixtures", name, "truth.json"),
      `${JSON.stringify(truth(output, { supported: true, flips: changed }), null, 2)}\n`,
    ),
  ),
);
