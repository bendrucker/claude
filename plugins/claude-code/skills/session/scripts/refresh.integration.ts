import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as path from "node:path";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");
const refreshScript = path.join(import.meta.dirname, "refresh.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "refresh-integration-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function env() {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: tmpDir,
    CLAUDE_PROJECTS_DIR: fixturesDir,
    CLAUDE_SESSION_IMPORTS_DIR: path.join(tmpDir, "imports"),
  };
}

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", refreshScript, ...args], {
    env: env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("refresh.ts", () => {
  it("prints the database path to stdout", async () => {
    const { stdout, exitCode } = await run();
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toEndWith("session.duckdb");
    expect(stdout.trim()).toStartWith(tmpDir);
  });

  it("is idempotent across repeated runs", async () => {
    const first = await run();
    const second = await run();
    expect(first.stdout).toBe(second.stdout);
    expect(second.exitCode).toBe(0);
  });

  it("accepts --refresh flag", async () => {
    const { stdout, exitCode } = await run("--refresh");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toEndWith("session.duckdb");
  });
});
