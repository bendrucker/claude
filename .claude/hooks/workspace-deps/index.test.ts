import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { processStop } from ".";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "workspace-deps-hook-"));
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
    const checker = await fakeChecker(
      "clean.ts",
      "export async function findViolations() { return []; }",
    );
    expect(await processStop(stopInput(), checker)).toBeNull();
  });

  it("blocks with the checker's violations", async () => {
    const checker = await fakeChecker(
      "violation.ts",
      `export async function findViolations() { return ['plugin-a: missing dependency "cleye"']; }`,
    );

    const output = await processStop(stopInput(), checker);
    expect(output?.decision).toBe("block");
    expect(output?.reason).toContain("Missing workspace dependencies detected");
    expect(output?.reason).toContain('missing dependency "cleye"\n');
  });

  test.each<{ name: string; source: string | null }>([
    {
      name: "reports a non-blocking systemMessage when the checker crashes",
      source: `throw new Error("Cannot find module '@bendrucker/claude-marketplace'");`,
    },
    { name: "does not block when the checker script is missing", source: null },
    {
      name: "does not block when the checker exports no findViolations",
      source: "export const findViolations = 1;",
    },
  ])("$name", async ({ name, source }) => {
    const checker =
      source === null
        ? join(tempDir, "missing.ts")
        : await fakeChecker(`${name.replaceAll(" ", "-")}.ts`, source);

    const output = await processStop(stopInput(), checker);
    expect(output?.decision).toBeUndefined();
    expect(output?.systemMessage).toContain("checker could not run");
  });
});
