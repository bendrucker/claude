import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { z } from "zod";
import {
  createConflictFixture,
  createDivergenceFixture,
  type DivergenceFixture,
  type Fixture,
} from "./fixtures/setup";

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
    const hookInput = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git commit" },
    });

    const Denial = z.object({
      hookSpecificOutput: z.looseObject({
        permissionDecision: z.string(),
        permissionDecisionReason: z.string(),
      }),
    });

    test("outputs deny JSON when markers in staged files", async () => {
      await $`git add file.txt`.cwd(fixture.path).quiet();

      const result = await $`echo ${hookInput} | bun ${join(scriptsDir, "check-markers.ts")}`
        .cwd(fixture.path)
        .text();

      const { hookSpecificOutput } = Denial.parse(JSON.parse(result));
      expect(hookSpecificOutput.permissionDecision).toBe("deny");
      expect(hookSpecificOutput.permissionDecisionReason).toContain("Conflict markers");
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

describe("upstream.ts", () => {
  describe("up to date", () => {
    let fixture: Fixture;

    beforeAll(async () => {
      fixture = await createDivergenceFixture();
      await $`git fetch origin`.cwd(fixture.path).quiet();
      await $`git merge origin/main`.cwd(fixture.path).quiet().nothrow();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    test("reports up to date when not diverged", async () => {
      const result = await $`bun ${join(scriptsDir, "upstream.ts")}`.cwd(fixture.path).text();
      expect(result).toContain("up to date");
    });
  });

  describe("diverged without overlap", () => {
    let fixture: DivergenceFixture;

    beforeAll(async () => {
      fixture = await createDivergenceFixture();
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    test("reports divergence with commit count", async () => {
      const result = await $`bun ${join(scriptsDir, "upstream.ts")}`.cwd(fixture.path).text();
      expect(result).toContain("Default branch: main");
      expect(result).toContain("Commits behind origin/main:");
      expect(result).toContain("No overlapping file changes");
    });
  });

  describe("diverged with overlapping files", () => {
    let fixture: DivergenceFixture;

    beforeAll(async () => {
      fixture = await createDivergenceFixture({ overlapping: true });
    });

    afterAll(async () => {
      await fixture.cleanup();
    });

    test("reports overlapping files", async () => {
      const result = await $`bun ${join(scriptsDir, "upstream.ts")}`.cwd(fixture.path).text();
      expect(result).toContain("Default branch: main");
      expect(result).toContain("Files modified on both sides");
      expect(result).toContain("shared.txt");
    });
  });
});
