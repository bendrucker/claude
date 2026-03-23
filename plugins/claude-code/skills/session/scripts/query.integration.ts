import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const fixturesDir = path.join(import.meta.dirname, "..", "fixtures", "sessions");
const queryScript = path.join(import.meta.dirname, "query.sh");

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

describe("query.sh", () => {
  it("produces table output with expected data", async () => {
    const proc = Bun.spawn(
      ["bash", queryScript, "SELECT session_id FROM sessions ORDER BY session_id"],
      {
        env: env(),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stdout).toContain("basic-session");
    expect(stdout).toContain("session_id");
  });

  it("is idempotent across repeated runs", async () => {
    const run = async () => {
      const proc = Bun.spawn(["bash", queryScript, "SELECT COUNT(*) as n FROM sessions"], {
        env: env(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      return stdout;
    };

    const first = await run();
    const second = await run();

    const extractCount = (output: string) => output.match(/\d+/)?.[0];
    expect(extractCount(first)).toBeTruthy();
    expect(extractCount(first)).toBe(extractCount(second));
  });

  it("exits with error when no argument is provided", async () => {
    const proc = Bun.spawn(["bash", queryScript], {
      env: env(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});
