import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadColumn } from "./column";
import { render } from "./compare";
import { erroredRuns, readResult } from "./result";
import { loadTags } from "./suite";
import { traceMeasures } from "./trace";

interface RunSpec {
  score: number;
  graders: [name: string, passed: boolean, scored?: boolean, explanation?: string][];
  reply?: string | undefined;
  /** Fields of the trace's result line beside the reply. */
  stats?: Record<string, unknown>;
  error?: string | null | undefined;
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
            const lines = [
              { type: "assistant" },
              { type: "result", result: run.reply, ...run.stats },
            ];
            writes.push(
              Bun.write(
                join(dir, "traces", `${name}-${arm}-${i}.jsonl`),
                lines.map((l) => JSON.stringify(l)).join("\n"),
              ),
            );
          }
          return {
            score: run.score,
            graders: run.graders.map(([g, passed, scored = true, explanation]) => ({
              name: g,
              passed,
              scored,
              explanation,
            })),
            error: run.error,
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
  stats: { num_turns: 2, duration_ms: 10_000, total_cost_usd: 0.1, usage: { output_tokens: 500 } },
});
const fail = (): RunSpec => ({
  score: 0,
  graders: [
    ["fact", false],
    ["fired", false, false],
  ],
  reply: "one two three four five six",
  stats: { num_turns: 5, duration_ms: 30_000, total_cost_usd: 0.3, usage: { output_tokens: 900 } },
});

describe("loadColumn", () => {
  test("pools runs across result files and marks unscored graders as indicators", async () => {
    const a = await result({ c: { with: [pass()], without: [fail()] } });
    const b = await result({ c: { with: [fail()] } });
    const column = await loadColumn([a, b]);
    expect(column.get("c/with")).toEqual({
      scores: [1, 0],
      words: [3, 6],
      turns: [2, 5],
      seconds: [10, 30],
      tokens: [500, 900],
      cost: [0.1, 0.3],
      errored: 0,
      graders: new Map([
        ["fact", [true, false]],
        ["fired (indicator)", [true, false]],
      ]),
    });
  });

  test("leaves errored runs out of the pool and counts them", async () => {
    const path = await result({
      c: {
        with: [
          pass(),
          { ...pass(), error: "exit 1: You've hit your session limit" },
          { ...fail(), graders: [["judge", false, true, "grader threw: judge call failed"]] },
        ],
      },
    });
    const cell = (await loadColumn([path])).get("c/with");
    expect([cell?.scores, cell?.errored]).toEqual([[1], 2]);
    expect(erroredRuns(await readResult(path))).toEqual([
      { label: "c/with/1: exit 1: You've hit your session limit", graded: true },
      { label: "c/with/2: grader threw: judge call failed", graded: true },
    ]);
  });

  test("reads a clean run's null error", async () => {
    const path = await result({ c: { with: [{ ...pass(), error: null }] } });
    expect((await loadColumn([path])).get("c/with")?.errored).toBe(0);
  });

  test("skips measures for runs without a trace", async () => {
    const path = await result({ c: { with: [{ ...pass(), reply: undefined }] } });
    const cell = (await loadColumn([path])).get("c/with");
    expect([cell?.words, cell?.turns, cell?.cost]).toEqual([[], [], []]);
  });
});

describe("traceMeasures", () => {
  const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");

  test.each<{ name: string; trace: string; expected: ReturnType<typeof traceMeasures> }>([
    {
      name: "a full result line",
      trace: jsonl(
        { type: "assistant" },
        {
          type: "result",
          result: "two words",
          num_turns: 3,
          duration_ms: 1500,
          total_cost_usd: 0.02,
          usage: { output_tokens: 40 },
        },
      ),
      expected: { words: 2, turns: 3, seconds: 1.5, tokens: 40, cost: 0.02 },
    },
    {
      name: "a result line without stats",
      trace: jsonl({ type: "result", result: "one" }),
      expected: { words: 1 },
    },
    {
      name: "past a truncated earlier line",
      trace: `{"type":"assist\n${jsonl({ type: "result", result: "one", num_turns: 2 })}\n`,
      expected: { words: 1, turns: 2 },
    },
    {
      name: "null stats as absent",
      trace: jsonl({ type: "result", result: "one", total_cost_usd: null, usage: null }),
      expected: { words: 1 },
    },
    { name: "no result line", trace: jsonl({ type: "assistant" }), expected: {} },
    { name: "an empty trace", trace: "", expected: {} },
  ])("reads $name", ({ trace, expected }) => {
    expect(traceMeasures(trace)).toEqual(expected);
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

test("marks cells too small to star", async () => {
  const base = await result({ c: { with: [fail(), fail()] } });
  const next = await result({ c: { with: [pass(), pass()] } });
  const columns = await Promise.all([loadColumn([base]), loadColumn([next])]);
  expect(render({ columns, labels: ["base", "next"], alpha: 0.1 })).toContain("1.00†");
});

test("marks a case whose errored runs left the pool", async () => {
  const base = await result({ c: { with: [fail()] } });
  const next = await result({ c: { with: [{ ...pass(), error: "exit 1: session limit" }] } });
  const columns = await Promise.all([loadColumn([base]), loadColumn([next])]);
  expect(render({ columns, labels: ["base", "next"], alpha: 0.1 })).toContain("c/with!");
});
