import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { lintFile, valeAlerts } from "../detection/vale";
import { newAlerts } from "./edit-scope";
import { detectChanges, hunksOf, snapshot } from "./worktree-changes";

const originalTmpdir = process.env.TMPDIR;
let stateDir: string;
let parent: string;
let repo: string;
let session: string;

const lintsMarkdown = (path: string): Promise<boolean> => Promise.resolve(extname(path) === ".md");

function git(...args: string[]): void {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: repo, stdout: "ignore", stderr: "pipe" },
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function write(name: string, content: string): Promise<void> {
  await Bun.write(join(repo, name), content);
}

async function changedLines(): Promise<Record<string, number[]>> {
  const detection = await detectChanges(session, repo, lintsMarkdown);
  if (detection.status !== "changed") throw new Error(detection.status);
  return Object.fromEntries(
    detection.files.map((file) => [file.path.slice(repo.length + 1), [...file.added]]),
  );
}

beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "worktree-state-"));
  process.env.TMPDIR = stateDir;
  parent = mkdtempSync(join(tmpdir(), "worktree-repos-"));
});

afterAll(async () => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  await rm(stateDir, { recursive: true, force: true });
  await rm(parent, { recursive: true, force: true });
});

beforeEach(async () => {
  session = crypto.randomUUID();
  repo = join(parent, session);
  await mkdir(repo);
  repo = await realpath(repo);
  git("init", "-q", "--template=", "-b", "main");
  await write("doc.md", "one\ntwo\nthree\n");
  await write(".gitignore", "ignored.md\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
});

describe("detectChanges", () => {
  test("reports the lines added to a clean tracked file", async () => {
    await snapshot(session, repo, lintsMarkdown);
    await write("doc.md", "one\nTWO\nthree\nfour\n");
    expect(await changedLines()).toEqual({ "doc.md": [2, 4] });
  });

  test("reports only the lines added since the snapshot to a file already dirty", async () => {
    await write("doc.md", "one\nold edit\nthree\n");
    await snapshot(session, repo, lintsMarkdown);
    await write("doc.md", "one\nold edit\nthree\nnew line\n");
    expect(await changedLines()).toEqual({ "doc.md": [4] });
  });

  test("reports every line of a new untracked file", async () => {
    await snapshot(session, repo, lintsMarkdown);
    await write("new.md", "a\nb\n");
    expect(await changedLines()).toEqual({ "new.md": [1, 2] });
  });

  test("skips gitignored files and extensions the linter skips", async () => {
    await snapshot(session, repo, lintsMarkdown);
    await write("ignored.md", "a\n");
    await write("code.ts", "a\n");
    expect(await changedLines()).toEqual({});
  });

  test("skips a dirty file the call left untouched", async () => {
    await write("doc.md", "one\nold edit\nthree\n");
    await snapshot(session, repo, lintsMarkdown);
    expect(await changedLines()).toEqual({});
  });

  test("follows a commit the call made", async () => {
    await snapshot(session, repo, lintsMarkdown);
    await write("doc.md", "one\ntwo\nthree\ncommitted\n");
    git("commit", "-qam", "edit");
    expect(await changedLines()).toEqual({ "doc.md": [4] });
  });

  test("lints nothing after a merge", async () => {
    git("checkout", "-qb", "side");
    await write("side.md", "side\n");
    git("add", ".");
    git("commit", "-qm", "side");
    git("checkout", "-q", "main");
    await write("main.md", "main\n");
    git("add", ".");
    git("commit", "-qm", "main");
    await snapshot(session, repo, lintsMarkdown);
    git("merge", "-q", "--no-edit", "side");
    expect(await detectChanges(session, repo, lintsMarkdown)).toEqual({ status: "head-reset" });
  });

  test("reports a missing snapshot", async () => {
    expect(await detectChanges(session, repo, lintsMarkdown)).toEqual({ status: "no-snapshot" });
  });
});

describe("hunksOf", () => {
  test("reads the new-side start of each hunk and its lines", () => {
    const diff = "--- a/x\n+++ b/x\n@@ -2 +2 @@\n-old\n+new\n@@ -9,0 +10,2 @@\n+a\n+b\n";
    expect(hunksOf(diff)).toEqual([
      { newStart: 2, lines: ["-old", "+new"] },
      { newStart: 10, lines: ["+a", "+b"] },
    ]);
  });
});

describe("alerts on a file already dirty", () => {
  test("reports the new line's alert and leaves the older one out", async () => {
    await write("doc.md", "# Notes\n\nEvery row that fits no slot.\n");
    await snapshot(session, repo, lintsMarkdown);
    await write("doc.md", "# Notes\n\nEvery row that fits no slot.\n\nThe tool names no file.\n");
    const detection = await detectChanges(session, repo, lintsMarkdown);
    if (detection.status !== "changed") throw new Error(detection.status);
    const [file] = detection.files;
    if (file === undefined) throw new Error("no change detected");
    const after = await lintFile(file.path);
    const before = await valeAlerts(file.original, { filePath: file.path });
    const reported = newAlerts(after, before, file.added).filter((alert) =>
      alert.Check.startsWith("ai-tells.NegatedObject"),
    );
    expect(reported.map((alert) => alert.Line)).toEqual([5]);
  });
});
