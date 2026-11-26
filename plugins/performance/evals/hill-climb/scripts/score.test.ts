import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadColumn } from "../../../../../packages/evals/column";
import { scoreResults } from "./score";

const suite = join(import.meta.dir, "..");
const example = async (name: string, file: string) =>
  (await Bun.file(join(suite, "examples", name, file)).text()).replace(/^---\n[\s\S]*?\n---\n/, "");

test("scoreResults writes ranking and off-CPU runs that compare.ts loads", async () => {
  const results = mkdtempSync(join(tmpdir(), "hill-climb-"));
  const trace = (result: string) => `${JSON.stringify({ type: "result", result })}\n`;
  const traces = {
    "logship-with-0": await example("logship", "pass.md"),
    "logship-with-1": await example("logship", "trap-first.md"),
    "logship-without-0": "Profile first.",
    "kvload-with-0": await example("kvload", "pass.md"),
    "kvload-without-0": "1. Hand-write the encoder.\n2. Faster crc32.",
    "docsync-with-0": "Done.",
    "decide-win-cli-with-0": "Decision: accept",
  };
  await Promise.all(
    Object.entries(traces).map(([name, reply]) =>
      Bun.write(join(results, "traces", `${name}.jsonl`), trace(reply)),
    ),
  );
  const scored = await scoreResults(suite, results);
  const scores = scored.cases.map((c) => [
    c.name,
    Object.fromEntries(
      Object.entries(c.arms).map(([arm, runs]) => [arm, runs.map((r) => r.score)]),
    ),
  ]);
  expect(scores).toEqual([
    ["kvload", { with: [1], without: [1 / 3] }],
    ["logship", { with: [1, 0.5], without: [0] }],
  ]);

  const out = join(results, "scored", "aggregate-result.json");
  expect(await Bun.file(out).exists()).toBe(true);
  const column = await loadColumn([out]);
  expect(column.get("kvload/with")?.graders.get("lead@1")).toEqual([true]);
  expect(column.get("logship/with")?.graders.get("cited-all")).toEqual([true, false]);
});
