import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { repoRoot, resolveScope, resolveScopes } from "./run";

describe("resolveScope", () => {
  test.each([
    ["plugins/writing/detection/scan.ts", "plugins/writing/"],
    ["plugins/writing/skills/scan/scripts/scan.ts", "plugins/writing/"],
    ["packages/validate/run.ts", "packages/validate/"],
    [".claude/hooks/biome/index.ts", "./.claude"],
    [".claude/skills/agent-ideas/sources.ts", "./.claude"],
    ["user/rules/typescript.md", "./user"],
  ])("%s -> %s", (file, expected) => {
    expect(resolveScope(file)).toBe(expected);
  });

  test("accepts absolute paths", () => {
    expect(resolveScope(join(repoRoot, "packages/validate/run.ts"))).toBe("packages/validate/");
  });

  test("falls back to the nearest ancestor dir containing tests", () => {
    expect(resolveScope("scripts/coverage/run.ts")).toBe("./scripts/coverage");
  });
});

describe("resolveScopes", () => {
  test("dedupes scopes shared by multiple files", () => {
    expect(resolveScopes(["packages/validate/run.ts", "packages/validate/validate.ts"])).toEqual([
      "packages/validate/",
    ]);
  });
});
