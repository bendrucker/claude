import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import hooks from "./hooks.json";

const found = hooks.hooks.PreToolUse.flatMap((matcher) => matcher.hooks)
  .map((hook) => hook.command)
  .find((command) => command.includes("--clear"));
if (found == null || found === "")
  throw new Error("hooks.json is missing the PreToolUse --clear command");
const clearCommand = found;

describe("PreToolUse --clear guard", () => {
  let binDir: string;

  beforeAll(async () => {
    binDir = mkdtempSync(join(tmpdir(), "tmux-clear-test-"));
    const stubs: Record<string, string> = {
      tmux: 'if [ "$1" = "show-options" ]; then printf \'%s\' "$FAKE_MARKER"; fi',
      bun: "",
    };
    for (const [name, body] of Object.entries(stubs)) {
      const path = join(binDir, name);
      // oxlint-disable-next-line no-await-in-loop -- two stub scripts; concurrency buys nothing.
      await Bun.write(path, `#!/bin/sh\necho "${name} $*" >> "$CALL_LOG"\n${body}`);
      Bun.spawnSync(["chmod", "+x", path]);
    }
  });

  afterAll(() => {
    Bun.spawnSync(["rm", "-rf", binDir]);
  });

  async function runClear(
    env: Record<string, string>,
  ): Promise<{ exitCode: number | null; calls: string[] }> {
    const log = join(binDir, `calls-${Math.random().toString(36).slice(2)}.log`);
    const proc = Bun.spawnSync(["sh", "-c", clearCommand], {
      env: {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALL_LOG: log,
        CLAUDE_PLUGIN_ROOT: "/plugin",
        ...env,
      },
    });
    const file = Bun.file(log);
    const calls = (await file.exists()) ? (await file.text()).trim().split("\n") : [];
    return { exitCode: proc.exitCode, calls };
  }

  test.each<{ name: string; env: Record<string, string>; calls: string[] }>([
    {
      name: "outside tmux: no subprocess at all",
      env: {},
      calls: [],
    },
    {
      name: "no marker for this pane: checks tmux, skips bun",
      env: { TMUX: "/tmp/tmux-1/default,1,0", TMUX_PANE: "%5" },
      calls: ["tmux show-options -gqv @claude_notification_5"],
    },
    {
      name: "marker set for this pane: runs bun --clear",
      env: { TMUX: "/tmp/tmux-1/default,1,0", TMUX_PANE: "%5", FAKE_MARKER: "3:Bash" },
      calls: [
        "tmux show-options -gqv @claude_notification_5",
        "bun /plugin/hooks/notification.ts --clear",
      ],
    },
    {
      name: "TMUX_PANE unset: falls through to bun for pane resolution",
      env: { TMUX: "/tmp/tmux-1/default,1,0" },
      calls: ["bun /plugin/hooks/notification.ts --clear"],
    },
  ])("$name", async ({ env, calls }) => {
    const result = await runClear(env);
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual(calls);
  });
});
