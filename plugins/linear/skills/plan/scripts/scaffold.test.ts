import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "./scaffold";

describe("scaffold", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `scaffold-test-${Date.now()}`);
  });

  afterEach(async () => {
    if (existsSync(dir)) {
      await rm(dir, { recursive: true });
    }
  });

  it("creates correct directory structure", async () => {
    await scaffold("my-project", dir);
    const root = join(dir, "linear-plan-my-project");

    expect(existsSync(join(root, "my-project.md"))).toBe(true);
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(true);
    expect(existsSync(join(root, "issues", "milestones"))).toBe(true);
  });

  it("spec file has correct header", async () => {
    await scaffold("my-project", dir);
    const content = await readFile(join(dir, "linear-plan-my-project", "my-project.md"), "utf-8");
    expect(content).toBe("# My Project\n");
  });

  it("settings.local.json has correct content", async () => {
    await scaffold("my-project", dir);
    const content = await readFile(
      join(dir, "linear-plan-my-project", ".claude", "settings.local.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual({
      permissions: {
        allow: ["mcp__linear"],
      },
    });
  });

  it("returns absolute path", async () => {
    const result = await scaffold("my-project", dir);
    expect(result).toBe(join(dir, "linear-plan-my-project"));
    expect(result.startsWith("/")).toBe(true);
  });

  it("uses custom --dir when provided", async () => {
    const customDir = join(dir, "custom");
    const result = await scaffold("test", customDir);
    expect(result).toBe(join(customDir, "linear-plan-test"));
    expect(existsSync(result)).toBe(true);
  });
});
