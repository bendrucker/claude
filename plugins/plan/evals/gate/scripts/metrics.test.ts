import { describe, expect, it } from "bun:test";
import { lineAccounting, median, nearLimit, overLimit, transcriptMetrics } from "./metrics";

const assistant = (...blocks: object[]) =>
  JSON.stringify({ type: "assistant", message: { content: blocks } });
const tool = (name: string, input: object = {}) => ({ type: "tool_use", name, input });

describe("transcriptMetrics", () => {
  it("counts tool calls, byte checks, and the result totals", () => {
    const lines = [
      JSON.stringify({ type: "system", subtype: "init" }),
      assistant({ type: "text", text: "Reworking." }, tool("Write", { file_path: "plans/a.md" })),
      assistant(tool("Bash", { command: "wc -c plans/a.md" })),
      assistant(
        tool("Edit", { file_path: "plans/a.md" }),
        tool("Bash", { command: "wc -m plans/a.md" }),
      ),
      assistant(tool("Bash", { command: "ls plans" })),
      "not json",
      JSON.stringify({
        type: "result",
        result: "DONE",
        usage: { output_tokens: 1234 },
        num_turns: 5,
        duration_ms: 60000,
        total_cost_usd: 0.5,
      }),
    ];
    expect(transcriptMetrics(lines)).toEqual({
      tools: { Write: 1, Bash: 3, Edit: 1 },
      wc_calls: 2,
      edits: 1,
      writes: 1,
      output_tokens: 1234,
      turns: 5,
      duration_ms: 60000,
      cost_usd: 0.5,
      done: true,
    });
  });

  it("reports a session that never finished", () => {
    const metrics = transcriptMetrics([assistant(tool("Read", { file_path: "x" }))]);
    expect(metrics.done).toBe(false);
    expect(metrics.output_tokens).toBe(0);
  });
});

describe("lineAccounting", () => {
  it("splits removed lines into moved and deleted", () => {
    const before = "# Plan\n\nkeep this\nmove this\ndrop this\n";
    const after = "# Plan\nkeep this\n";
    expect(lineAccounting(before, after, ["# Decisions\n\n  move this  \n"])).toEqual({
      before: 4,
      after: 2,
      carried: 2,
      moved: 1,
      deleted: 1,
    });
  });
});

describe("limits", () => {
  it.each([
    [10_001, true, false],
    [10_000, false, true],
    [9_001, false, true],
    [9_000, false, false],
  ])("%d chars", (chars, over, near) => {
    expect(overLimit(chars)).toBe(over);
    expect(nearLimit(chars)).toBe(near);
  });
});

it("median handles odd, even, and empty inputs", () => {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([4, 1, 3, 2])).toBe(2.5);
  expect(median([])).toBe(0);
});
