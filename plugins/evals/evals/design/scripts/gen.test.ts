import { describe, expect, test } from "bun:test";
import { globSync } from "node:fs";
import { join } from "node:path";
import { passes, RegexGrader } from "../../../../../packages/evals/graders";
import { files } from "./gen";
import { SHARED } from "./graders";
import { written, tagged, writtenTo } from "./patterns";
import { CASES } from "./spec";

const suite = join(import.meta.dir, "..");

function matches(pattern: string, text: string, flags = ""): boolean {
  return passes(RegexGrader.parse({ type: "regex", pattern, flags, match: "contains" }), text);
}

function call(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({ message: { content: [{ type: "tool_use", name, input }] } });
}

describe("committed files match the generator", () => {
  test.each(Object.entries(files()))("%s", async (path, text) => {
    expect(await Bun.file(join(suite, path)).text()).toBe(text);
  });

  test("no case, grader, or example is left over from an earlier generation", () => {
    const generated = new Set(Object.keys(files()));
    const handWritten = new Set(["prompt.md", "fixture.sh"]);
    const committed = globSync(
      "{*/case.yaml,*/graders/*.md,graders/*.md,examples/*/*,suite.yaml}",
      {
        cwd: suite,
      },
    );
    expect(committed.filter((f) => !generated.has(f))).toEqual([]);
    const sizes = CASES.flatMap((c) =>
      [...handWritten].map((f) => Bun.file(join(suite, c.name, f)).size),
    );
    for (const size of sizes) expect(size).toBeGreaterThan(0);
  });
});

describe("the suite's own design", () => {
  test("about a third of the cases are holdout, and every brief kind has both splits", () => {
    const holdout = CASES.filter((c) => c.split === "holdout").length;
    expect(holdout / CASES.length).toBeGreaterThanOrEqual(0.25);
    expect(holdout / CASES.length).toBeLessThanOrEqual(0.45);
    expect(new Set(CASES.map((c) => c.brief))).toEqual(
      new Set(["skill", "agent", "rule", "quiet", "removal", "extend", "pydantic"]),
    );
  });

  test("exactly one llm grader, and it states a pass bar", () => {
    const llm = Object.entries(SHARED).filter(([, s]) => s.grader.type === "llm");
    expect(llm.map(([name]) => name)).toEqual(["holdout-share"]);
    expect(llm[0]?.[1].grader.body).toMatch(/pass when/i);
    const perCaseLlm = Object.entries(files()).filter(
      ([path, text]) => path.includes("/graders/") && text.includes("type: llm"),
    );
    expect(perCaseLlm).toEqual([]);
  });

  // The with-minus-without gap measures the skill only while the prompt leaves its rules unstated.
  test("every prompt opens with the skill and leaves the design rules unstated", async () => {
    const prompts = await Promise.all(
      CASES.map((c) => Bun.file(join(suite, c.name, "prompt.md")).text()),
    );
    for (const prompt of prompts) {
      expect(prompt).toStartWith("/evals:design ");
      expect(prompt).toMatch(/kind/);
      expect(prompt).not.toMatch(
        /\b(?:split|holdout|quiet case|balance case|judge|pass bar|survival)\b/i,
      );
    }
  });

  test("no prompt or fixture carries text from a real transcript or work repo", async () => {
    const text = await Promise.all(
      CASES.flatMap((c) =>
        ["prompt.md", "fixture.sh"].map((f) => Bun.file(join(suite, c.name, f)).text()),
      ),
    );
    for (const t of text) expect(t).not.toMatch(/bendrucker|drucker|\/Users\//);
  });
});

describe("trace patterns", () => {
  const tag = written(tagged("holdout"));
  const path = writtenTo(String.raw`case\.yaml`, String.raw`tags: \[`);

  test("a Write matches in either key order", () => {
    const content = "name: a\ntags: [fix, holdout]\n";
    expect(matches(tag, call("Write", { file_path: "a/case.yaml", content }))).toBe(true);
    expect(matches(tag, call("Write", { content, file_path: "a/case.yaml" }))).toBe(true);
    expect(matches(path, call("Write", { content, file_path: "a/case.yaml" }))).toBe(true);
  });

  test("an Edit that retags a case matches", () => {
    const edit = { file_path: "a/case.yaml", old_string: "[dev]", new_string: "tags: [holdout]" };
    expect(matches(tag, call("Edit", edit))).toBe(true);
    expect(matches(tag, call("Edit", { replace_all: false, ...edit }))).toBe(true);
  });

  test("a block-style tag list matches", () => {
    const content = "tags:\n  - fix\n  - holdout\n";
    expect(matches(tag, call("Write", { file_path: "a/case.yaml", content }))).toBe(true);
  });

  test("the prompt and the skill text never match, only tool calls do", () => {
    const text = JSON.stringify({ type: "user", message: { content: "tags: [holdout]" } });
    expect(matches(tag, text)).toBe(false);
    expect(matches(tag, call("Read", { content: "tags: [holdout]" }))).toBe(false);
  });

  test("a tag in the wrong word does not match", () => {
    const content = "tags: [fix, holdouts-later]\n";
    expect(matches(tag, call("Write", { file_path: "a/case.yaml", content }))).toBe(false);
  });
});
