import { describe, expect, test } from "bun:test";

const HOOK = new URL("./test/hook.fixture.ts", import.meta.url).pathname;

async function run(
  stdin: string,
  env: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["bun", HOOK], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  proc.stdin.write(stdin);
  await proc.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("runHook", () => {
  test("writes the handler's non-null return as JSON", async () => {
    const { stdout, code } = await run(JSON.stringify({ tool_input: { file_path: "a.ts" } }));
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "a.ts" },
    });
  });

  test("writes nothing when the handler returns null", async () => {
    const { stdout, code } = await run(JSON.stringify({ tool_input: {} }));
    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("logs a thrown handler error and stays non-blocking (exit 0)", async () => {
    const { stdout, stderr, code } = await run(
      JSON.stringify({ tool_input: { file_path: "THROW" } }),
    );
    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("[hook.fixture] handler boom");
  });

  test("derives the hook name from the entry module by default", async () => {
    const { stderr, code } = await run("not json");
    expect(code).toBe(0);
    expect(stderr).toContain("[hook.fixture] Failed to parse hook input:");
  });

  test("derives plugin/module when CLAUDE_PLUGIN_ROOT is set", async () => {
    const { stderr } = await run("not json", { CLAUDE_PLUGIN_ROOT: "/plugins/demo" });
    expect(stderr).toContain("[demo/hook.fixture] Failed to parse hook input:");
  });

  test("honors an explicit name override", async () => {
    const { stderr } = await run("not json", { HOOK_NAME_OVERRIDE: "custom/name" });
    expect(stderr).toContain("[custom/name] Failed to parse hook input:");
  });
});
