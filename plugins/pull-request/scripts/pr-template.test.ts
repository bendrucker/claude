import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findTemplate } from "./pr-template";

describe("findTemplate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pr-template-")));
    execSync("git init -q", { cwd: tempDir, stdio: "pipe" });
    execSync("git remote add origin git@github.com:user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("finds .github/PULL_REQUEST_TEMPLATE.md", async () => {
    const dir = path.join(tempDir, ".github");
    mkdirSync(dir);
    await Bun.write(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "## Description\n");
    expect(await findTemplate("github", tempDir)).toBe("## Description\n");
  });

  it("finds lowercase pull_request_template.md", async () => {
    await Bun.write(path.join(tempDir, "pull_request_template.md"), "## Summary\n");
    expect(await findTemplate("github", tempDir)).toBe("## Summary\n");
  });

  it("finds docs/pull_request_template.md", async () => {
    const dir = path.join(tempDir, "docs");
    mkdirSync(dir);
    await Bun.write(path.join(dir, "pull_request_template.md"), "## Changes\n");
    expect(await findTemplate("github", tempDir)).toBe("## Changes\n");
  });

  it("prefers .github/ over root", async () => {
    const dir = path.join(tempDir, ".github");
    mkdirSync(dir);
    await Bun.write(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "preferred\n");
    await Bun.write(path.join(tempDir, "PULL_REQUEST_TEMPLATE.md"), "fallback\n");
    expect(await findTemplate("github", tempDir)).toBe("preferred\n");
  });

  it("returns null when no template exists", async () => {
    expect(await findTemplate("github", tempDir)).toBeNull();
  });

  it("finds gitlab default template", async () => {
    const dir = path.join(tempDir, ".gitlab", "merge_request_templates");
    mkdirSync(dir, { recursive: true });
    await Bun.write(path.join(dir, "Default.md"), "## MR\n");
    expect(await findTemplate("gitlab", tempDir)).toBe("## MR\n");
  });

  it("does not search github paths for gitlab provider", async () => {
    const dir = path.join(tempDir, ".github");
    mkdirSync(dir);
    await Bun.write(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "github template\n");
    expect(await findTemplate("gitlab", tempDir)).toBeNull();
  });

  it("does not search gitlab paths for github provider", async () => {
    const dir = path.join(tempDir, ".gitlab", "merge_request_templates");
    mkdirSync(dir, { recursive: true });
    await Bun.write(path.join(dir, "Default.md"), "gitlab template\n");
    expect(await findTemplate("github", tempDir)).toBeNull();
  });

  it("returns null for unknown provider", async () => {
    const dir = path.join(tempDir, ".github");
    mkdirSync(dir);
    await Bun.write(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "template\n");
    expect(await findTemplate("unknown", tempDir)).toBeNull();
  });
});
