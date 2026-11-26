import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { decide, metricsPath, REASON } from "./dispatch-then-list";

const deny: SyncHookJSONOutput = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: REASON,
  },
};

const bash = (command: string) => ({
  session_id: "abc",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
});

describe("decide", () => {
  test.each<[string, string, boolean]>([
    [
      "a chained dispatch",
      "gh workflow run eval.yml --ref B -f suite=S && sleep 10 && gh run list --workflow eval.yml --limit 1",
      true,
    ],
    [
      "a loop of dispatches",
      "for s in a b c; do gh workflow run eval.yml -f suite=$s; done\ngh run list --limit 2",
      true,
    ],
    [
      "a commit message quoting the chain",
      'git commit -m "avoid gh workflow run eval.yml && gh run list --limit 1"',
      false,
    ],
    ["a lone dispatch", "gh workflow run eval.yml --ref B -f suite=S", false],
    ["a lone list", "gh run list --workflow eval.yml --limit 1", false],
  ])("%s denies: %p", (_name, command, denied) => {
    expect(decide(bash(command))).toEqual(denied ? deny : null);
  });

  test("passes input without a command string", () => {
    expect(decide({ tool_input: {} })).toBeNull();
    expect(decide(null)).toBeNull();
  });
});

describe("metricsPath", () => {
  test.each<[string | undefined, string | null]>([
    ["off", null],
    ["/m", "/m/github-dispatch-then-list.jsonl"],
  ])("%p -> %p", (env, expected) => {
    expect(metricsPath(env)).toBe(expected);
  });
});

function ancestors(dir: string): string[] {
  const dirs = [dir];
  while (dirname(dirs.at(-1) ?? "/") !== dirs.at(-1)) dirs.push(dirname(dirs.at(-1) ?? "/"));
  return dirs;
}

describe("dependency-free execution", () => {
  let dir: string;
  let metrics: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "dispatch-then-list-"));
    metrics = join(dir, "metrics");
    await Promise.all(
      ["dispatch-then-list.ts", "gh-invocations.ts"].map(async (name) =>
        Bun.write(join(dir, name), Bun.file(join(import.meta.dirname, name))),
      ),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function runHook(command: string) {
    const proc = Bun.spawn(["bun", "--no-install", join(dir, "dispatch-then-list.ts")], {
      cwd: dir,
      env: { ...process.env, CLAUDE_HOOK_METRICS: metrics },
      stdin: Buffer.from(JSON.stringify(bash(command))),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  }

  test("resolves no node_modules from the copy's directory", async () => {
    const listings = await Promise.all(
      ancestors(dir).map(async (d) => readdir(d).catch((): string[] => [])),
    );
    expect(listings.some((names) => names.includes("node_modules"))).toBe(false);
  });

  test("denies a chain and records each invocation", async () => {
    expect(await runHook("gh workflow run x.yml && gh run list -L 1")).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${JSON.stringify(deny)}\n`,
    });
    expect(await runHook("gh workflow run x.yml")).toEqual({ exitCode: 0, stderr: "", stdout: "" });

    const lines = (await Bun.file(join(metrics, "github-dispatch-then-list.jsonl")).text())
      .trim()
      .split("\n");
    const identity = '"session_id":"abc","hook_event":"PreToolUse","tool":"Bash"';
    expect(lines.map((line) => /"outcome":"(\w+)"/.exec(line)?.[1])).toEqual(["deny", "silent"]);
    expect(lines.every((line) => line.includes(identity))).toBe(true);
  });
});
