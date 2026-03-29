import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");
const queryScript = path.join(import.meta.dirname, "query.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "query-integration-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function env() {
  return {
    ...process.env,
    CLAUDE_PLUGIN_DATA: tmpDir,
    CLAUDE_PROJECTS_DIR: fixturesDir,
  };
}

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", queryScript, ...args], {
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

describe("query.ts", () => {
  it("lists sessions", async () => {
    const { stdout, exitCode } = await run("SELECT session_id FROM sessions ORDER BY session_id");
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it("runs named queries", async () => {
    const { stdout, exitCode } = await run("stats");
    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it("is idempotent across repeated runs", async () => {
    const first = await run("SELECT COUNT(*) as n FROM sessions");
    const second = await run("SELECT COUNT(*) as n FROM sessions");
    expect(first.stdout).toBe(second.stdout);
  });

  it("exits with error when no argument is provided", async () => {
    const { stderr, exitCode } = await run();
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});
