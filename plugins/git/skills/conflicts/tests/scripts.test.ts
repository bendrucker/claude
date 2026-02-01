import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { createConflictFixture, type Fixture } from "./fixtures/setup";

const scriptsDir = join(import.meta.dirname, "..", "scripts");

describe("conflicts scripts", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createConflictFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  describe("status.ts", () => {
    test("lists conflicted files with counts", async () => {
      const result = await $`bun ${join(scriptsDir, "status.ts")}`.cwd(fixture.path).text();

      expect(result).toContain("file.txt");
      expect(result).toMatch(/\d+ conflict/);
    });
  });

  describe("context.ts", () => {
    test("shows operation type and incoming commits", async () => {
      const result = await $`bun ${join(scriptsDir, "context.ts")}`.cwd(fixture.path).text();

      expect(result).toContain("Operation: merge");
      expect(result).toContain("Incoming commits:");
    });
  });

  describe("check-markers.ts", () => {
    const hookInput = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit" } });

    test("outputs deny JSON when markers in staged files", async () => {
      await $`git add file.txt`.cwd(fixture.path).quiet();

      const result = await $`echo ${hookInput} | bun ${join(scriptsDir, "check-markers.ts")}`
        .cwd(fixture.path)
        .text();

      const output = JSON.parse(result);
      expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain("Conflict markers");
    });

    test("outputs nothing when no markers", async () => {
      await Bun.write(join(fixture.path, "file.txt"), "resolved content\n");
      await $`git add file.txt`.cwd(fixture.path).quiet();

      const result = await $`echo ${hookInput} | bun ${join(scriptsDir, "check-markers.ts")}`
        .cwd(fixture.path)
        .text();

      expect(result.trim()).toBe("");
    });
  });
});
