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
    ["no-op", "Use your best judgment."],
    ["no-op", "Use your best judgement."],
    ["weak-modality", 'A “stray opener. Try to keep going, then "quoted" text.'],
    ["stale-measurement", "The floor sits at 10.4 on the full corpus."],
    ["stale-measurement", "Separation dropped to 18 on the shorter bins."],
    ["stale-measurement", "253 of 901 shapes clear the floor."],
    ["stale-measurement", "All thirteen features clear their floor."],
    ["ticket-ref", "Treat the rates as uncalibrated until #791 lands."],
    ["status-prose", "The comparison has not run yet."],
    ["status-prose", "Calibration is still pending."],
    ["status-prose", "A larger labeled pass comes next."],
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
    ["a curly-quoted phrase", "Replace a weak word (“be thorough”) with a stronger one."],
    ["an emphasized quoted phrase", 'Replace a weak word ("*be thorough*") with a stronger one.'],
    ["a linked quoted phrase", 'Replace a weak word ("[be thorough](x)") with a stronger one.'],
    [
      "a quote around a code span",
      'Replace a weak word ("be `very` thorough") with a stronger one.',
    ],
    ["a scoping count", "Record a decision when all three hold."],
    ["a budget rather than a result", "A long-form essay can yield 2-3 cards."],
    ["a flag default", "Raise `--min-lift` (default 5.0) when the list is noisy."],
    ["a blockquote example", "Flagged example:\n\n> All 47 tests pass, ensuring correctness.\n"],
    ["a linked issue", "Teammates may idle ([#23415](https://example.com/23415))."],
    ["an ordinary condition", "When something is still open, resolve it first."],
    ["a formatter directive", "<!-- prettier-ignore-start -->"],
    ["a short aside", "<!-- tuned by hand -->"],
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

  test("stops quote pairing at the end of a block", () => {
    const source = 'A "stray opener.\n\nTry to keep going.\n\nThen "quoted" text.\n';
    expect(scanPrompt(source)).toMatchObject([{ line: 3, rule: "weak-modality" }]);
  });

  test("flags prose held in a comment", () => {
    const source =
      "# Doc\n\n<!--\nCuration note for maintainers. Skip this block when reviewing a document.\n-->\n";
    expect(scanPrompt(source)).toMatchObject([{ line: 3, rule: "maintainer-aside" }]);
  });

  test("reports every finding in one document, ordered by position", () => {
    const source = "Please read it.\n\nMake sure it works.\n";
    expect(rules(source)).toEqual(["no-op", "vague-criterion"]);
  });
});
