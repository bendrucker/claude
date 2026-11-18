import { describe, expect, it } from "bun:test";
import { lastPlan, scoreTrace } from "./brief-score";

const VALID = [
  "# Plan",
  "",
  "## Brief",
  "",
  "Approach: add a flag.",
  "",
  "Decisions:",
  "- Parse with commander. Rejected: hand parsing (`cli.ts:3`).",
  "",
  "Measure: deterministic code → a failing test first.",
  "",
].join("\n");

function write(path: string, content: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", name: "Write", input: { file_path: path, content } }],
    },
  });
}

describe("lastPlan", () => {
  it("takes the last write to plan.md and ignores other files", () => {
    const trace = [
      JSON.stringify({ type: "system", subtype: "init" }),
      write("/w/plan.md", "first"),
      write("/w/notes.md", "other"),
      write("/w/plan.md", "second"),
    ].join("\n");
    expect(lastPlan(trace)).toBe("second");
  });
});

describe("scoreTrace", () => {
  it.each<{ name: string; trace: string; problems: number; wrote: boolean }>([
    { name: "valid brief", trace: write("/w/plan.md", VALID), problems: 0, wrote: true },
    {
      name: "no brief",
      trace: write("/w/plan.md", "# Plan\n\nDo it.\n"),
      problems: 1,
      wrote: true,
    },
    { name: "no write", trace: JSON.stringify({ type: "system" }), problems: 1, wrote: false },
  ])("$name", ({ trace, problems, wrote }) => {
    const score = scoreTrace("r", trace);
    expect(score.wrote).toBe(wrote);
    expect(score.problems).toHaveLength(problems);
  });
});
