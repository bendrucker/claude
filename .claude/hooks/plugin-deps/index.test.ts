import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { VIOLATION_EXIT } from "../../../scripts/check-plugin-deps";
import { processStop } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "plugin-deps-hook-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function stopInput(overrides?: Partial<StopHookInput>): StopHookInput {
  return {
    hook_event_name: "Stop",
    session_id: "test",
    transcript_path: "/dev/null",
    cwd: tempDir,
    stop_hook_active: false,
    permission_mode: "default",
    ...overrides,
  };
}

async function fakeChecker(name: string, source: string): Promise<string> {
  const path = join(tempDir, name);
  await Bun.write(path, source);
  return path;
}

describe("processStop", () => {
  it("returns null when the stop hook is already active", async () => {
    expect(await processStop(stopInput({ stop_hook_active: true }))).toBeNull();
  });

  it("returns null when the checker passes", async () => {
    const checker = await fakeChecker("clean.ts", "process.exit(0);");
    expect(await processStop(stopInput(), checker)).toBeNull();
  });

  it("blocks with the checker's stderr on the violation exit code", async () => {
    const checker = await fakeChecker(
      "violation.ts",
      `console.error('plugin-a: missing dependency "cleye"');
process.exit(${VIOLATION_EXIT});`,
    );

    const output = await processStop(stopInput(), checker);
    expect(output?.decision).toBe("block");
    expect(output?.reason).toContain("Missing plugin dependencies detected");
    expect(output?.reason).toContain('missing dependency "cleye"');
  });

  it("reports a non-blocking systemMessage when the checker crashes", async () => {
    const checker = await fakeChecker(
      "crash.ts",
      `throw new Error("Cannot find module '@bendrucker/claude-marketplace'");`,
    );

    const output = await processStop(stopInput(), checker);
    expect(output?.decision).toBeUndefined();
    expect(output?.systemMessage).toContain("checker could not run");
  });

  it("does not block when the checker script is missing", async () => {
    const output = await processStop(stopInput(), join(tempDir, "missing.ts"));
    expect(output?.decision).toBeUndefined();
    expect(output?.systemMessage).toContain("checker could not run");
  });
});
