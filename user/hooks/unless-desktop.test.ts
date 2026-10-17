import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookMetric } from "../scripts/hook-metrics";

const SCRIPT = join(import.meta.dirname, "unless-desktop.sh");
const INPUT = JSON.stringify({ session_id: "s1", hook_event_name: "PermissionRequest" });

function run(entrypoint: string | undefined, metrics: string, command = ["cat"]) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: metrics };
  if (entrypoint !== undefined) env.CLAUDE_CODE_ENTRYPOINT = entrypoint;
  env.CLAUDE_HOOK_METRICS = metrics;
  return Bun.spawnSync([SCRIPT, ...command], { env, stdin: Buffer.from(INPUT) });
}

async function logged(dir: string): Promise<HookMetric[]> {
  const file = Bun.file(join(dir, "unless-desktop.jsonl"));
  if (!(await file.exists())) return [];
  return (await file.text())
    .trim()
    .split("\n")
    .map((line) => HookMetric.parse(JSON.parse(line)));
}

describe("unless-desktop", () => {
  // oxlint-disable-next-line vitest/prefer-each -- one body over the entrypoints that run the command.
  for (const entrypoint of [undefined, "cli", "remote_desktop", "sdk-ts"]) {
    test(`runs the command for ${entrypoint ?? "no entrypoint"}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "unless-desktop-"));
      const result = run(entrypoint, dir);
      expect(result.stdout.toString()).toBe(INPUT);
      expect(await logged(dir)).toEqual([]);
    });
  }

  test("passes the command's exit status through", () => {
    const dir = mkdtempSync(join(tmpdir(), "unless-desktop-"));
    expect(run("cli", dir, ["sh", "-c", "exit 3"]).exitCode).toBe(3);
  });

  // oxlint-disable-next-line vitest/prefer-each -- one body over the desktop entrypoints.
  for (const entrypoint of ["claude-desktop", "claude-desktop-3p"]) {
    test(`skips the command and logs the skip for ${entrypoint}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "unless-desktop-"));
      const result = run(entrypoint, dir, ["sh", "-c", "echo ran; exit 3"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe("");
      const rows = await logged(dir);
      expect(
        rows.map(({ session_id, hook_event, tool, outcome }) => ({
          session_id,
          hook_event,
          tool,
          outcome,
        })),
      ).toEqual([
        { session_id: "s1", hook_event: "PermissionRequest", tool: null, outcome: "silent" },
      ]);
    });
  }

  test("logs nothing when hook metrics are off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "unless-desktop-"));
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: dir,
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
      CLAUDE_HOOK_METRICS: "off",
    };
    const result = Bun.spawnSync([SCRIPT, "cat"], { env, stdin: Buffer.from(INPUT) });
    expect(result.exitCode).toBe(0);
    expect(await logged(join(dir, ".claude", "hook-metrics"))).toEqual([]);
  });
});
