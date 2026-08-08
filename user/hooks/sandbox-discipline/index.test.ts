import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { formatDenyOutput, processInput } from "./index";

const scratch = mkdtempSync(join(tmpdir(), "sandbox-discipline-index-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

beforeAll(async () => {
  await Bun.write(
    join(scratch, "marked.ts"),
    "#!/usr/bin/env bun\n// claude:dangerouslyDisableSandbox: hands off to Launch Services\n",
  );
  await Bun.write(join(scratch, "plain.ts"), "#!/usr/bin/env bun\nconsole.log(1);\n");
});

function slug(name: string): string {
  return name.replace(/\W+/g, "-");
}

async function writeTranscript(name: string, command: string, result: string): Promise<string> {
  const path = join(scratch, name);
  const use = JSON.stringify({
    message: {
      content: [{ type: "tool_use", id: "a", name: "Bash", input: { command } }],
    },
  });
  const res = JSON.stringify({
    message: {
      content: [{ type: "tool_result", tool_use_id: "a", content: result }],
    },
  });
  await Bun.write(path, `${use}\n${res}\n`);
  return path;
}

function bashInput(
  toolInput: Record<string, unknown>,
  extra: Partial<PreToolUseHookInput> = {},
): PreToolUseHookInput {
  return {
    tool_name: "Bash",
    tool_input: toolInput,
    cwd: scratch,
    ...extra,
  } as PreToolUseHookInput;
}

type GateCase = {
  name: string;
  command: string;
  /** A prior Bash call in the transcript and the result it produced. Omit for no transcript. */
  prior?: { command: string; result: string };
  denies: string | null;
};

describe("bypass gate", () => {
  test.each<GateCase>([
    {
      name: "denies with no prior sandboxed failure",
      command: "bun plain.ts",
      prior: { command: "ls", result: "a\nb\n" },
      denies: "bun",
    },
    {
      name: "denies with no transcript to check",
      command: "curl https://example.com",
      denies: "curl",
    },
    {
      name: "denies when the prior failure was a different verb",
      command: "bun plain.ts",
      prior: { command: "npm install", result: "EPERM: operation not permitted" },
      denies: "bun",
    },
    {
      name: "denies when the prior failure was unrelated to the sandbox",
      command: "bun plain.ts",
      prior: { command: "bun plain.ts", result: "error: Cannot find module './missing'" },
      denies: "bun",
    },
    {
      name: "denies a cd-prefixed git bypass rather than rewriting it",
      command: "cd /repo && git push",
      denies: "git",
    },
    {
      name: "denies a command whose only verb is preamble",
      command: "cd /repo",
      denies: "cd",
    },
    {
      name: "allows a marked script",
      command: "bun marked.ts",
      prior: { command: "ls", result: "a\n" },
      denies: null,
    },
    {
      name: "allows a marked script behind a bun run subcommand",
      command: "bun run marked.ts",
      denies: null,
    },
    {
      name: "allows after a sandboxed failure of the same verb",
      command: "bun plain.ts",
      prior: { command: "bun plain.ts", result: "plain.ts: /tmp/out: Operation not permitted" },
      denies: null,
    },
    {
      name: "allows when the failure and the retry differ only by preamble",
      command: "FOO=1 bun plain.ts",
      prior: { command: "cd /repo && bun plain.ts", result: "EPERM: operation not permitted" },
      denies: null,
    },
    {
      name: "allows after an Apple Events privilege violation",
      command: "osascript -l JavaScript -e 'Application(\"Things3\")'",
      prior: {
        command: "osascript -l JavaScript -e 'Application(\"Things3\")'",
        result: "execution error: An error occurred. (-10004)",
      },
      denies: null,
    },
    {
      name: "allows a browser sign-in handoff that can never fail sandboxed",
      command: "glab auth login --hostname gitlab.com --git-protocol ssh",
      denies: null,
    },
  ])("$name", async ({ name, command, prior, denies }) => {
    const extra = prior
      ? {
          transcript_path: await writeTranscript(
            `${slug(name)}.jsonl`,
            prior.command,
            prior.result,
          ),
        }
      : {};
    const output = await processInput(
      bashInput({ command, dangerouslyDisableSandbox: true }, extra),
    );
    expect(output).toEqual(denies === null ? null : formatDenyOutput(denies));
  });

  test("names the verb and the rule in the denial", () => {
    expect(
      formatDenyOutput("gh").hookSpecificOutput?.permissionDecisionReason,
    ).toMatchInlineSnapshot(
      `"Run \`gh\` sandboxed first. \`dangerouslyDisableSandbox\` is for a command the sandbox has already refused, and this session has no failed sandboxed \`gh\` run to point at. Re-run without the bypass. If it fails with a sandbox error, retry with the bypass and this hook will let it through."`,
    );
  });
});

describe("cd-prefix rewrite", () => {
  test("rewrites an exact cd-and-git command", async () => {
    expect(
      await processInput(bashInput({ command: "cd /repo && git status" })),
    ).toMatchInlineSnapshot(`
      {
        "hookSpecificOutput": {
          "hookEventName": "PreToolUse",
          "updatedInput": {
            "command": "git -C /repo status",
          },
        },
      }
    `);
  });

  test("preserves the rest of the tool input", async () => {
    const output = await processInput(
      bashInput({ command: "cd /repo && git status", description: "check status", timeout: 5000 }),
    );
    expect(output?.hookSpecificOutput?.updatedInput).toEqual({
      command: "git -C /repo status",
      description: "check status",
      timeout: 5000,
    });
  });

  test.each<{ name: string; command: string }>([
    { name: "a compound with a second git", command: "cd /repo && git add . && git commit -m x" },
    { name: "a pipeline", command: "cd /repo && git log | head" },
    { name: "a redirect", command: "cd /repo && git log > out.txt" },
    { name: "a semicolon separator", command: "cd /repo; git status" },
    { name: "a non-git command", command: "cd /repo && bun test" },
    { name: "a bare git command", command: "git status" },
  ])("leaves $name untouched", async ({ command }) => {
    expect(await processInput(bashInput({ command }))).toBeNull();
  });

  test("ignores an input with no command", async () => {
    expect(await processInput(bashInput({}))).toBeNull();
  });
});
