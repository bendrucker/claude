import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pValue, render } from "./compare";
import { loadColumn, loadTags } from "./load";

interface RunSpec {
  score: number;
  graders: [name: string, passed: boolean, scored?: boolean][];
  reply?: string | undefined;
}

/** Writes an aggregate-result.json with one case per entry, and a trace for each run with a reply. */
async function result(cases: Record<string, Record<string, RunSpec[]>>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "compare-"));
  const writes: Promise<number>[] = [];
  const body = Object.entries(cases).map(([name, arms]) => ({
    name,
    arms: Object.fromEntries(
      Object.entries(arms).map(([arm, runs]) => [
        arm,
        runs.map((run, i) => {
          if (run.reply !== undefined) {
            const lines = [{ type: "assistant" }, { type: "result", result: run.reply }];
            writes.push(
              Bun.write(
                join(dir, "traces", `${name}-${arm}-${i}.jsonl`),
                lines.map((l) => JSON.stringify(l)).join("\n"),
              ),
            );
          }
          return {
            score: run.score,
            graders: run.graders.map(([g, passed, scored = true]) => ({ name: g, passed, scored })),
          };
        }),
      ]),
    ),
  }));
  writes.push(Bun.write(join(dir, "aggregate-result.json"), JSON.stringify({ cases: body })));
  await Promise.all(writes);
  return join(dir, "aggregate-result.json");
}

const pass = (score = 1): RunSpec => ({
  score,
  graders: [
    ["fact", true],
    ["fired", true, false],
  ],
  reply: "one two three",
});
const fail = (): RunSpec => ({
  score: 0,
  graders: [
    ["fact", false],
    ["fired", false, false],
  ],
  reply: "one two three four five six",
});

describe("pValue", () => {
  test.each<{ name: string; base: number[]; other: number[]; expected: number }>([
    { name: "identical constant samples", base: [1, 1, 1], other: [1, 1], expected: 1 },
    { name: "an empty side", base: [], other: [1], expected: NaN },
  ])("returns $expected for $name", ({ base, other, expected }) => {
    expect(pValue(base, other)).toBe(expected);
  });

  test("separates six passes from six failures", () => {
    expect(pValue([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0])).toBeLessThan(0.1);
  });

  test("does not separate one flip in three", () => {
    expect(pValue([1, 1, 1], [1, 1, 0])).toBeGreaterThan(0.1);
  });
});

describe("loadColumn", () => {
  test("pools runs across result files and marks unscored graders as indicators", async () => {
    const a = await result({ c: { with: [pass()], without: [fail()] } });
    const b = await result({ c: { with: [fail()] } });
    const column = await loadColumn([a, b]);
    expect(column.get("c/with")).toEqual({
      scores: [1, 0],
      words: [3, 6],
      graders: new Map([
        ["fact", [true, false]],
        ["fired (indicator)", [true, false]],
      ]),
    });
  });

  test("skips word counts for runs without a trace", async () => {
    const path = await result({ c: { with: [{ ...pass(), reply: undefined }] } });
    expect((await loadColumn([path])).get("c/with")?.words).toEqual([]);
  });
});

describe("render", () => {
  test("stars rows that moved and leads the markdown with them", async () => {
    const base = await result({ c: { with: Array.from({ length: 6 }, () => pass()) } });
    const next = await result({ c: { with: Array.from({ length: 6 }, fail) } });
    const columns = await Promise.all([loadColumn([base]), loadColumn([next])]);
    expect(
      render({ columns, labels: ["base", "next"], alpha: 0.1, markdown: true }),
    ).toMatchSnapshot();
  });

  test("rolls case scores up by tag", async () => {
    const suite = mkdtempSync(join(tmpdir(), "suite-"));
    await Promise.all([
      Bun.write(join(suite, "a/case.yaml"), "tags: [dev]\n"),
      Bun.write(join(suite, "b/case.yaml"), "tags: [holdout]\n"),
    ]);
    const path = await result({
      a: { with: [pass(), pass(0.5)], without: [fail()] },
      b: { with: [fail()], without: [fail()] },
    });
    const column = await loadColumn([path]);
    const tags = await loadTags(suite);
    expect(render({ columns: [column], labels: ["base"], alpha: 0.1, tags })).toMatchSnapshot();
  });
});
