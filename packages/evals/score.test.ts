import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regrade } from "./regrade";
import { Result } from "./result";
import { scoreSuite } from "./score";

/** Marks every run's `code` grader passed when its collected `adapter.ts` exists. */
const SCRIPT = `
const [output] = process.argv.slice(2);
const path = output + "/aggregate-result.json";
const result = await Bun.file(path).json();
for (const c of result.cases)
  for (const [arm, runs] of Object.entries(c.arms))
    for (const [i, run] of runs.entries()) {
      const passed = await Bun.file(output + "/artifacts/" + c.name + "-" + arm + "-" + i + "/adapter.ts").exists();
      run.graders = [...run.graders.filter((g) => g.name !== "code"), { name: "code", passed }];
    }
await Bun.write(path, JSON.stringify(result));
`;

async function fixture(score: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "score-"));
  const suite = join(dir, "suite");
  const results = join(suite, "results/run");
  const scripts = score === undefined ? {} : { score };
  await Promise.all([
    Bun.write(join(suite, "package.json"), JSON.stringify({ scripts })),
    Bun.write(join(suite, "score.ts"), SCRIPT),
    Bun.write(join(results, "artifacts/one-with-0/adapter.ts"), "export default {}"),
    Bun.write(
      join(results, "aggregate-result.json"),
      JSON.stringify({
        cases: [{ name: "one", arms: { with: [{ graders: [] }, { graders: [] }] } }],
      }),
    ),
  ]);
  return { suite, results };
}

const verdicts = async (dir: string) =>
  Result.parse(await Bun.file(join(dir, "aggregate-result.json")).json()).cases[0]?.arms.with?.map(
    (run) => run.graders.map((g) => [g.name, g.passed]),
  );

test.each<{ name: string; script: string | undefined; expected: [string, boolean][][] }>([
  {
    name: "a score script",
    script: "bun score.ts",
    expected: [[["code", true]], [["code", false]]],
  },
  { name: "no score script", script: undefined, expected: [[], []] },
])("scoreSuite with $name", async ({ script, expected }) => {
  const { suite, results } = await fixture(script);
  await scoreSuite(suite, results);
  expect(await verdicts(results)).toEqual(expected);
});

test("regrade carries artifacts over and reports the score script's flips", async () => {
  const { suite, results } = await fixture("bun score.ts");
  const out = `${results}-regraded`;
  expect(await regrade(suite, results, out)).toEqual([
    { grader: "one/code", run: "one-with-0", passed: true },
    { grader: "one/code", run: "one-with-1", passed: false },
  ]);
  expect(await Bun.file(join(out, "artifacts/one-with-0/adapter.ts")).exists()).toBe(true);
});
