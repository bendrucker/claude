import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_FILE_FLAG, FIELD_FILE_GUARD, PROSE_FLAGS } from "./check-tropes";
import config from "./hooks.json";

type HookCommand = { type: string; command: string; if?: string };
type HookEntry = { matcher: string; hooks: HookCommand[] };

const preToolUse = config.hooks.PreToolUse as HookEntry[];

function scriptName(command: string): string {
  return command.match(/hooks\/([\w-]+)\.ts/)?.[1] ?? command;
}

function findCommand(matcher: string, script: string): string {
  const entry = preToolUse.find((candidate) => candidate.matcher === matcher);
  const hook = entry?.hooks.find((candidate) => scriptName(candidate.command) === script);
  if (!hook) throw new Error(`hooks.json is missing ${script} under matcher ${matcher}`);
  return hook.command;
}

describe("PreToolUse gating", () => {
  test("every matcher routes to the single dispatcher", () => {
    const view = Object.fromEntries(
      preToolUse.map((entry) => [
        entry.matcher,
        entry.hooks.map((hook) => ({
          script: scriptName(hook.command),
          guarded: hook.command.startsWith("in=$(cat);"),
        })),
      ]),
    );
    expect(view).toEqual({
      Write: [{ script: "pretooluse", guarded: false }],
      Edit: [{ script: "pretooluse", guarded: false }],
      MultiEdit: [{ script: "pretooluse", guarded: false }],
      Bash: [{ script: "pretooluse", guarded: true }],
    });
  });

  test("Bash guard alternation is derived from the flags check-tropes extracts", () => {
    const command = findCommand("Bash", "pretooluse");
    const alternation = `--(${PROSE_FLAGS.map((flag) => flag.slice(2)).join("|")})[-= ]`;
    expect(command).toContain(alternation);
    expect(command).toContain(FIELD_FILE_GUARD);
    expect(`${BODY_FILE_FLAG} `).toMatch(new RegExp(alternation));
  });
});

describe("inline guard behavior", () => {
  let binDir: string;

  beforeAll(async () => {
    binDir = mkdtempSync(join(tmpdir(), "writing-guard-test-"));
    const stub = join(binDir, "bun");
    await Bun.write(stub, '#!/bin/sh\necho "bun $*" >> "$CALL_LOG"\ncat > /dev/null\n');
    Bun.spawnSync(["chmod", "+x", stub]);
  });

  afterAll(() => {
    Bun.spawnSync(["rm", "-rf", binDir]);
  });

  async function runGuard(
    command: string,
    input: Record<string, unknown>,
  ): Promise<{ exitCode: number | null; calls: string[] }> {
    const log = join(binDir, `calls-${Math.random().toString(36).slice(2)}.log`);
    const proc = Bun.spawnSync(["sh", "-c", command], {
      stdin: Buffer.from(JSON.stringify(input)),
      env: {
        PATH: `${binDir}:/usr/bin:/bin`,
        CALL_LOG: log,
        CLAUDE_PLUGIN_ROOT: "/plugin",
      },
    });
    const file = Bun.file(log);
    const calls = (await file.exists()) ? (await file.text()).trim().split("\n") : [];
    return { exitCode: proc.exitCode, calls };
  }

  test.each<{ name: string; command: string; runs: boolean }>([
    { name: "no prose flags", command: "git status", runs: false },
    {
      name: "gh with title and body",
      command: 'gh pr create --title "Hi" --body "There"',
      runs: true,
    },
    {
      name: "arbitrary CLI with description",
      command: "mycli publish --description 'x'",
      runs: true,
    },
    { name: "body file", command: "jira update --body-file /tmp/x.md", runs: true },
    {
      name: "gh api short field file",
      command: "gh api repos/x/issues -F body=@tmp/reply.md",
      runs: true,
    },
    {
      name: "glab api long field file",
      command: "glab api projects/x/merge_requests --field description=@tmp/mr.md",
      runs: true,
    },
    { name: "field with inline value", command: "gh api repos/x -F state=closed", runs: false },
    { name: "flag-free long command", command: "ls -la && bun test plugins/writing", runs: false },
  ])("dispatcher bash: $name", async ({ command, runs }) => {
    const hookCommand = findCommand("Bash", "pretooluse");
    const result = await runGuard(hookCommand, {
      tool_name: "Bash",
      tool_input: { command },
    });
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual(runs ? ["bun /plugin/hooks/pretooluse.ts"] : []);
  });
});
