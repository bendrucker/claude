import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_FILE_FLAG, PROSE_FLAGS } from "./check-tropes";
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
  test("matchers, guards, and if conditions", () => {
    const view = Object.fromEntries(
      preToolUse.map((entry) => [
        entry.matcher,
        Object.fromEntries(
          entry.hooks.map((hook) => [
            scriptName(hook.command),
            { guarded: hook.command.startsWith("in=$(cat);"), if: hook.if ?? null },
          ]),
        ),
      ]),
    );
    expect(view).toEqual({
      Write: {
        numbering: { guarded: true, if: null },
        headings: { guarded: false, if: "Write(**/*.md)" },
        "check-tropes": { guarded: false, if: null },
      },
      Edit: {
        numbering: { guarded: true, if: null },
        headings: { guarded: false, if: "Edit(**/*.md)" },
        "check-tropes": { guarded: false, if: null },
      },
      MultiEdit: {
        "check-tropes": { guarded: false, if: null },
      },
      Bash: {
        "check-tropes": { guarded: true, if: null },
      },
    });
  });

  test("Bash guard alternation is derived from the flags check-tropes extracts", () => {
    const command = findCommand("Bash", "check-tropes");
    const alternation = `--(${PROSE_FLAGS.map((flag) => flag.slice(2)).join("|")})[-= ]`;
    expect(command).toContain(alternation);
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

  // Every shape checkMarkdown or a numbering.yml rule can flag must launch the
  // full check; content that cannot match must skip the bun spawn.
  test.each<{ name: string; content: string; runs: boolean }>([
    { name: "markdown numbered heading", content: "## 1. Setup\n\nBody\n", runs: true },
    { name: "markdown Step heading", content: "# Step 1\n", runs: true },
    { name: "markdown Phase heading, wide gap", content: "# Phase    2\n", runs: true },
    { name: "tab after heading number", content: "## 3.\tSetup\n", runs: true },
    { name: "code identifier step1", content: "function step1() {}\n", runs: true },
    { name: "code identifier Phase2", content: "class Phase2:\n    pass\n", runs: true },
    {
      name: "code identifier part3 in any language",
      content: "part3 <- function(x) x\n",
      runs: true,
    },
    { name: "plain prose", content: "Descriptive names only.\n", runs: false },
    { name: "version string", content: "Bump to v1.2.3\n", runs: false },
    { name: "bare code", content: "const total = sum(items)\n", runs: false },
  ])("numbering: $name", async ({ content, runs }) => {
    const command = findCommand("Write", "numbering");
    const result = await runGuard(command, {
      tool_name: "Write",
      tool_input: { file_path: "/repo/example.R", content },
    });
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual(runs ? ["bun /plugin/hooks/numbering.ts write"] : []);
  });

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
    { name: "flag-free long command", command: "ls -la && bun test plugins/writing", runs: false },
  ])("check-tropes bash: $name", async ({ command, runs }) => {
    const hookCommand = findCommand("Bash", "check-tropes");
    const result = await runGuard(hookCommand, {
      tool_name: "Bash",
      tool_input: { command },
    });
    expect(result.exitCode).toBe(0);
    expect(result.calls).toEqual(runs ? ["bun /plugin/hooks/check-tropes.ts"] : []);
  });
});
