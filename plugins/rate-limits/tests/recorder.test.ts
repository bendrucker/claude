import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { innerArgv } from "../scripts/recorder";

describe("innerArgv", () => {
  test.each<{ name: string; argv: string[]; expected: string[] }>([
    { name: "strips a leading -- separator", argv: ["--", "cmd", "arg"], expected: ["cmd", "arg"] },
    { name: "leaves argv without a separator", argv: ["cmd", "arg"], expected: ["cmd", "arg"] },
    { name: "drops only the first -- ", argv: ["--", "cmd", "--"], expected: ["cmd", "--"] },
    { name: "empty stays empty", argv: [], expected: [] },
  ])("$name", ({ argv, expected }) => {
    expect(innerArgv(argv)).toEqual(expected);
  });
});

describe("recorder inner command", () => {
  const recorder = join(import.meta.dir, "..", "scripts", "recorder.ts");

  // The README documents `recorder.ts -- <inner-cmd>`. The separator must not
  // reach Bun.spawn as a literal argv[0], or the inner statusline never renders.
  test("runs the inner command through a -- separator", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rate-limits-recorder-"));
    const payload = JSON.stringify({
      rate_limits: { five_hour: { used_percentage: 42, resets_at: 2000 } },
    });

    const proc = Bun.spawn(["bun", recorder, "--", "cat"], {
      stdin: new Response(payload),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        CLAUDE_STATUSLINE_RATE_LIMITS_PATH: join(dir, "rl.json"),
        CLAUDE_RATE_LIMITS_HISTORY_PATH: join(dir, "history.ndjson"),
      },
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(stdout).toBe(payload);
  });
});
