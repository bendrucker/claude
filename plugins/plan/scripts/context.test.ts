import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = join(import.meta.dirname, "context.sh");

async function run(input: unknown, markerRoot: string) {
  const proc = Bun.spawn(["bash", scriptPath], {
    stdin: Buffer.from(JSON.stringify(input)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PLAN_MARKER_ROOT: markerRoot },
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

describe("plan context hook", () => {
  let markerRoot: string;

  beforeEach(() => {
    markerRoot = mkdtempSync(join(tmpdir(), "plan-context-test-"));
  });

  afterEach(async () => {
    await rm(markerRoot, { recursive: true, force: true });
  });

  test("injects guidelines on first plan-mode prompt", async () => {
    const stdout = await run({ permission_mode: "plan", session_id: "t1" }, markerRoot);
    expect(stdout).toContain("plan");
  });

  test("stays silent on non-plan mode", async () => {
    const stdout = await run({ permission_mode: "default", session_id: "t1" }, markerRoot);
    expect(stdout).toBe("");
  });

  test("stays silent on repeat plan-mode prompt in the same session", async () => {
    await run({ permission_mode: "plan", session_id: "t1" }, markerRoot);
    const stdout = await run({ permission_mode: "plan", session_id: "t1" }, markerRoot);
    expect(stdout).toBe("");
  });

  test("re-injects for a different session id", async () => {
    await run({ permission_mode: "plan", session_id: "t1" }, markerRoot);
    const stdout = await run({ permission_mode: "plan", session_id: "t2" }, markerRoot);
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("injects without deduping when session_id is missing", async () => {
    const first = await run({ permission_mode: "plan" }, markerRoot);
    const second = await run({ permission_mode: "plan" }, markerRoot);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });
});
