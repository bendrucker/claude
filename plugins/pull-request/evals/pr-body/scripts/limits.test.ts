import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "../../../../../evals/native/regrade";
import { applyLimits, type Body, bodyOf, render } from "./limits";

const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const spans = (n: number) => Array.from({ length: n }, (_, i) => `\`c${i}\``).join(" ");

const grader = (name: string, passed: boolean) => ({
  name,
  passed,
  weight: 1,
  scored: true,
  withOnly: false,
});

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");

const toolResult = (content: unknown) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "t", content }] },
});

const stubTrace = (body: string) =>
  jsonl([
    toolResult([{ type: "text", text: `PR-BODY-BEGIN\n${body}\nPR-BODY-END\n` }]),
    { type: "result", result: "Opened it." },
  ]);

const replyTrace = (reply: string) => jsonl([{ type: "result", result: reply }]);

test("scores the stub body when a tool result carries one and the reply otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "limits-"));
  const results = join(dir, "run");
  const out = join(dir, "run-limits");
  const run = (score: number) => ({ score, graders: [grader("fact", true)] });
  await Promise.all([
    Bun.write(
      join(results, "aggregate-result.json"),
      JSON.stringify({
        aggregates: { overallScore: 1 },
        cases: [{ name: "one", arms: { with: [run(1), run(1), run(1)], without: [run(1)] } }],
      }),
    ),
    Bun.write(
      join(results, "traces/one-with-0.jsonl"),
      stubTrace(`${long(10)} ${spans(7)}\n\n<details>\n\n${long(70)}\n\n</details>`),
    ),
    Bun.write(
      join(results, "traces/one-with-1.jsonl"),
      replyTrace(`Title: Fix it\n\n${long(130)}`),
    ),
    Bun.write(join(results, "traces/one-without-0.jsonl"), stubTrace(long(10))),
  ]);

  const counts = await applyLimits(results, out);
  const written = Result.parse(await Bun.file(join(out, "aggregate-result.json")).json());
  expect(written.aggregates).toBeUndefined();
  const rows = (arm: string, i: number) =>
    written.cases[0]?.arms[arm]?.[i]?.graders.map((g) => [g.name, g.passed]);
  expect(rows("with", 0)).toEqual([
    ["fact", true],
    ["visible-words", true],
    ["max-block", true],
    ["prose-code-spans", false],
    ["hidden-words", false],
  ]);
  expect(rows("with", 1)).toEqual([
    ["fact", true],
    ["visible-words", false],
    ["max-block", false],
    ["prose-code-spans", true],
    ["hidden-words", true],
  ]);
  expect(written.cases[0]?.arms.with?.[0]?.graders.at(-1)?.explanation).toContain("from stub");
  expect(written.cases[0]?.arms.with?.[1]?.graders.at(-1)?.explanation).toContain("from reply");
  expect(written.cases[0]?.arms.with?.map((r) => r.score)).toEqual([3 / 5, 3 / 5, 1]);
  expect(written.cases[0]?.arms.without?.[0]?.score).toBe(1);
  expect(await Bun.file(join(out, "traces/one-with-1.jsonl")).exists()).toBe(true);
  expect(render(counts)).toMatchInlineSnapshot(`
    "╔══════╤════════════════════╤════════════════╤═══════════════════════╤═══════════════════╤═══════════════════════╤═══════════════════╤══════════════════════════╤══════════════════════╗
    ║ case │ with visible-words │ with max-block │ with prose-code-spans │ with hidden-words │ without visible-words │ without max-block │ without prose-code-spans │ without hidden-words ║
    ╟──────┼────────────────────┼────────────────┼───────────────────────┼───────────────────┼───────────────────────┼───────────────────┼──────────────────────────┼──────────────────────╢
    ║ one  │ 1/2                │ 1/2            │ 1/2                   │ 1/2               │ 1/1                   │ 1/1               │ 1/1                      │ 1/1                  ║
    ╚══════╧════════════════════╧════════════════╧═══════════════════════╧═══════════════════╧═══════════════════════╧═══════════════════╧══════════════════════════╧══════════════════════╝
    "
  `);
});

test.each<{ name: string; trace: string; body: string | undefined; source?: Body["source"] }>([
  {
    name: "string tool_result content",
    trace: jsonl([toolResult("noise\nPR-BODY-BEGIN\nHello\nPR-BODY-END")]),
    body: "Hello",
    source: "stub",
  },
  {
    name: "last stub block wins",
    trace: jsonl([
      toolResult("PR-BODY-BEGIN\nfirst\nPR-BODY-END"),
      toolResult("PR-BODY-BEGIN\nsecond\nPR-BODY-END"),
    ]),
    body: "second",
    source: "stub",
  },
  {
    name: "stub beats the reply",
    trace: jsonl([
      toolResult("PR-BODY-BEGIN\nstub\nPR-BODY-END"),
      { type: "result", result: "Title: T\n\nreply" },
    ]),
    body: "stub",
    source: "stub",
  },
  { name: "reply without a Title line", trace: replyTrace("Just prose."), body: undefined },
])("bodyOf: $name", ({ trace, body, source }) => {
  expect(bodyOf(trace)?.text).toBe(body);
  expect(bodyOf(trace)?.source).toEqual(source);
});
