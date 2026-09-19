import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fixture, PROJECT } from "./fixture";
import { parseProject, readProjects } from "./projects";

describe("projects", () => {
  test("reads the frontmatter and leaves the body alone", () => {
    expect(parseProject("ledger", PROJECT)).toEqual({
      slug: "ledger",
      name: "Ledger routing",
      description: "Dispatch ledger, project routing, and the chief and lead sessions that read it",
      repo: "/repo",
      tracker: "https://example.test/projects/ledger",
    });
  });

  test("lists project.md files by slug and reports the ones it cannot read", async () => {
    const warnings: string[] = [];
    const projects = await readProjects(await fixture(), (message) => warnings.push(message));
    expect(projects.map((project) => project.slug)).toEqual(["ledger"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/broken\/project\.md: .*no frontmatter/);
  });

  test("is empty without a projects directory", async () => {
    expect(await readProjects(mkdtempSync(join(tmpdir(), "ledger-")))).toEqual([]);
  });

  test.each([["Ledger"], ["a".repeat(28)], ["1st"]])("rejects the slug %s", (slug) => {
    expect(() => parseProject(slug, PROJECT)).toThrow(/to name a lead-/);
  });

  test("reports what an empty frontmatter block is missing", () => {
    expect(() => parseProject("ledger", "---\n---\n\nBody.\n")).toThrow(/name/);
  });

  test("keeps a rule inside a block scalar out of the fence", () => {
    const text = "---\nname: N\ndescription: |\n  one\n  ---\n  two\n---\n\nBody.\n";
    expect(parseProject("ledger", text).description).toBe("one\n---\ntwo\n");
  });
});
