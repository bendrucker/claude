import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findTemplate } from "./pr-template";

describe("findTemplate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pr-template-")));
    execSync("git init -q", { cwd: tempDir, stdio: "pipe" });
    execSync("git remote add origin git@github.com:user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds .github/PULL_REQUEST_TEMPLATE.md", () => {
    const dir = path.join(tempDir, ".github");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "## Description\n");
    expect(findTemplate("github", tempDir)).toBe("## Description\n");
  });

  it("finds lowercase pull_request_template.md", () => {
    fs.writeFileSync(path.join(tempDir, "pull_request_template.md"), "## Summary\n");
    expect(findTemplate("github", tempDir)).toBe("## Summary\n");
  });

  it("finds docs/pull_request_template.md", () => {
    const dir = path.join(tempDir, "docs");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "pull_request_template.md"), "## Changes\n");
    expect(findTemplate("github", tempDir)).toBe("## Changes\n");
  });

  it("prefers .github/ over root", () => {
    const dir = path.join(tempDir, ".github");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "preferred\n");
    fs.writeFileSync(path.join(tempDir, "PULL_REQUEST_TEMPLATE.md"), "fallback\n");
    expect(findTemplate("github", tempDir)).toBe("preferred\n");
  });

  it("returns null when no template exists", () => {
    expect(findTemplate("github", tempDir)).toBeNull();
  });

  it("finds gitlab default template", () => {
    const dir = path.join(tempDir, ".gitlab", "merge_request_templates");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Default.md"), "## MR\n");
    expect(findTemplate("gitlab", tempDir)).toBe("## MR\n");
  });

  it("does not search github paths for gitlab provider", () => {
    const dir = path.join(tempDir, ".github");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "github template\n");
    expect(findTemplate("gitlab", tempDir)).toBeNull();
  });

  it("does not search gitlab paths for github provider", () => {
    const dir = path.join(tempDir, ".gitlab", "merge_request_templates");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "Default.md"), "gitlab template\n");
    expect(findTemplate("github", tempDir)).toBeNull();
  });

  it("returns null for unknown provider", () => {
    const dir = path.join(tempDir, ".github");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "PULL_REQUEST_TEMPLATE.md"), "template\n");
    expect(findTemplate("unknown", tempDir)).toBeNull();
  });
});
