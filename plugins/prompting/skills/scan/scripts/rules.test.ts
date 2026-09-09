import { describe, expect, test } from "bun:test";
import { scanPrompt } from "./rules";

function rules(source: string): string[] {
  return scanPrompt(source).map((finding) => finding.rule);
}

describe("scanPrompt", () => {
  test.each([
    ["weak-modality", "Try to keep the title short."],
    ["weak-modality", "Update the changelog as needed."],
    ["weak-modality", "Consider adding a test."],
    ["vague-criterion", "Make sure the branch is clean."],
    ["vague-criterion", "Handle the error appropriately."],
    ["vague-criterion", "Iterate until satisfied."],
    ["no-op", "Be thorough when reading the diff."],
    ["no-op", "Please read the file first."],
    ["no-op", "Think step by step."],
  ])("flags %s in %j", (rule, source) => {
    expect(rules(source)).toEqual([rule]);
  });

  test.each([
    ["a checkable criterion", "Stop when every modified file has a test."],
    ["an imperative", "Write one-line comments."],
    ["a fenced example", "```\nTry to keep it short.\n```"],
    ["inline code", "Run `make sure-clean` first."],
    ["a quoted phrase", 'Replace a weak word ("be thorough") with a stronger one.'],
    ["frontmatter", "---\nname: never-used\ndescription: Please pick a name.\n---\n\nWrite it."],
  ])("passes %s", (_label, source) => {
    expect(rules(source)).toEqual([]);
  });

  test("reports the source line past frontmatter", () => {
    const source = "---\nname: demo\n---\n\nTry to run it.\n";
    expect(scanPrompt(source)).toMatchObject([{ line: 5, rule: "weak-modality" }]);
  });

  test("reports the source line of a soft-wrapped paragraph", () => {
    const source = "Read the diff first.\nThen try to summarize it.\n";
    expect(scanPrompt(source)).toMatchObject([{ line: 2, col: 6 }]);
  });

  test("reports every finding in one document, ordered by position", () => {
    const source = "Please read it.\n\nMake sure it works.\n";
    expect(rules(source)).toEqual(["no-op", "vague-criterion"]);
  });
});
