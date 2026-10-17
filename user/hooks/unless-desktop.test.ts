import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HookMetric } from "../scripts/hook-metrics";

const SCRIPT = join(import.meta.dirname, "unless-desktop.sh");
const INPUT = JSON.stringify({ session_id: "s1", hook_event_name: "PermissionRequest" });

function run(entrypoint: string, command: string[]) {
  const home = mkdtempSync(join(tmpdir(), "unless-desktop-"));
  const env = { PATH: process.env.PATH ?? "", HOME: home, CLAUDE_CODE_ENTRYPOINT: entrypoint };
  const result = Bun.spawnSync([SCRIPT, ...command], { env, stdin: Buffer.from(INPUT) });
  return { result, log: join(home, ".claude", "hook-metrics", "unless-desktop.jsonl") };
}

describe("unless-desktop", () => {
  test("runs the command outside the desktop app", () => {
    const { result } = run("cli", ["sh", "-c", "cat; exit 3"]);
    expect(result.stdout.toString()).toBe(INPUT);
    expect(result.exitCode).toBe(3);
  });

  test("skips the command and logs the skip in the desktop app", async () => {
    const { result, log } = run("claude-desktop", ["sh", "-c", "echo ran; exit 3"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    const row = HookMetric.parse(JSON.parse(await Bun.file(log).text()));
    expect(row.hook_event).toBe("PermissionRequest");
  });
});
