import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { findTemplate } from "./pr-template";

type TemplateFile = [path: string, content: string];

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

  async function writeFiles(files: TemplateFile[]) {
    await Promise.all(
      files.map(([file, content]) => {
        const dest = path.join(tempDir, file);
        mkdirSync(path.dirname(dest), { recursive: true });
        return Bun.write(dest, content);
      }),
    );
  }

  test.each<[string, TemplateFile[], "github" | "gitlab", string | null]>([
    [
      "finds .github/PULL_REQUEST_TEMPLATE.md",
      [[".github/PULL_REQUEST_TEMPLATE.md", "## Description\n"]],
      "github",
      "## Description\n",
    ],
    [
      "finds lowercase pull_request_template.md",
      [["pull_request_template.md", "## Summary\n"]],
      "github",
      "## Summary\n",
    ],
    [
      "finds docs/pull_request_template.md",
      [["docs/pull_request_template.md", "## Changes\n"]],
      "github",
      "## Changes\n",
    ],
    [
      "prefers .github/ over root",
      [
        [".github/PULL_REQUEST_TEMPLATE.md", "preferred\n"],
        ["PULL_REQUEST_TEMPLATE.md", "fallback\n"],
      ],
      "github",
      "preferred\n",
    ],
    ["returns null when no template exists", [], "github", null],
    [
      "finds gitlab default template",
      [[".gitlab/merge_request_templates/Default.md", "## MR\n"]],
      "gitlab",
      "## MR\n",
    ],
    [
      "does not search github paths for gitlab provider",
      [[".github/PULL_REQUEST_TEMPLATE.md", "github template\n"]],
      "gitlab",
      null,
    ],
    [
      "does not search gitlab paths for github provider",
      [[".gitlab/merge_request_templates/Default.md", "gitlab template\n"]],
      "github",
      null,
    ],
  ])("%s", async (_name, files, provider, expected) => {
    await writeFiles(files);
    expect(await findTemplate(provider, tempDir)).toBe(expected);
  });
});
