import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProvider } from "./detect-provider";

describe("detect-provider", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "detect-provider-")));
    execSync("git init -q", { cwd: tempDir, stdio: "pipe" });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects github.com", () => {
    execSync("git remote add origin git@github.com:user/repo.git", { cwd: tempDir, stdio: "pipe" });
    expect(detectProvider(tempDir)).toBe("github");
  });

  it("detects github.com https", () => {
    execSync("git remote add origin https://github.com/user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectProvider(tempDir)).toBe("github");
  });

  it("detects gitlab.com", () => {
    execSync("git remote add origin git@gitlab.com:user/repo.git", { cwd: tempDir, stdio: "pipe" });
    expect(detectProvider(tempDir)).toBe("gitlab");
  });

  it("detects gitlab.com https", () => {
    execSync("git remote add origin https://gitlab.com/user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectProvider(tempDir)).toBe("gitlab");
  });

  it("detects self-hosted gitlab (gitlab.*)", () => {
    execSync("git remote add origin git@gitlab.company.com:user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectProvider(tempDir)).toBe("gitlab");
  });

  it("detects self-hosted gitlab (*.gitlab.*)", () => {
    execSync("git remote add origin git@git.gitlab.company.com:user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectProvider(tempDir)).toBe("gitlab");
  });

  it("returns unknown for other hosts", () => {
    execSync("git remote add origin git@bitbucket.org:user/repo.git", {
      cwd: tempDir,
      stdio: "pipe",
    });
    expect(detectProvider(tempDir)).toBe("unknown");
  });

  it("returns unknown when no remote", () => {
    expect(detectProvider(tempDir)).toBe("unknown");
  });
});
