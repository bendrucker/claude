import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import type { CaseRecord } from "./case-record";
import { caseYaml, files, graderMd, INSTRUCTION, promptMd } from "./generate";

function makeCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: "l-abcd1234",
    host: "local",
    session_id: "abcd1234-0000-0000-0000-000000000000",
    project: "proj",
    tags: ["simplify"],
    prefix: "## User\n\nPlan a thing",
    redirect: "Drop the second step.\nIt is overkill.",
    original_plan: "# Plan",
    ...overrides,
  };
}

describe("case files", () => {
  test("lays out the three files under the case directory", () => {
    expect(Object.keys(files(makeCase())).toSorted()).toEqual([
      "case-l-abcd1234/case.yaml",
      "case-l-abcd1234/graders/pre-empts-redirect.md",
      "case-l-abcd1234/prompt.md",
    ]);
  });

  test("case.yaml names the case and keeps the plan plugin out of its tools", () => {
    const parsed: unknown = parse(caseYaml(makeCase({ tags: ["measure"] })));
    expect(parsed).toMatchObject({
      name: "case-l-abcd1234",
      tags: ["measure"],
      plugins: ["../.."],
      execution: { allowed_tools: ["Read", "Glob", "Grep", "Write"] },
    });
    expect(parsed).not.toHaveProperty("execution.prompt");
  });

  test.each([
    { name: "prefix leads", check: (p: string) => p.startsWith("## User") },
    { name: "instruction closes", check: (p: string) => p.endsWith(`${INSTRUCTION}\n`) },
  ])("prompt: $name", ({ check }) => {
    expect(check(promptMd(makeCase()))).toBe(true);
  });

  test("grader is an llm grader on plan.md and embeds the redirect", () => {
    const text = graderMd(makeCase());
    const frontmatter: unknown = parse(text.split("---")[1] ?? "");
    expect(frontmatter).toEqual({ type: "llm", focus: { source: "file", path: "plan.md" } });
    expect(text).toContain("> Drop the second step.\n> It is overkill.");
  });
});
