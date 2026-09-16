import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { extractScripts, hasBypassMarker, processInput, tokenize, tokenText } from "./sandbox";

let fixtureDir: string;
let markedScriptPath: string;
let unmarkedScriptPath: string;

beforeAll(async () => {
  fixtureDir = await mkdtemp(`${tmpdir()}${sep}sandbox-test-`);

  markedScriptPath = join(fixtureDir, "marked.ts");
  await Bun.write(
    markedScriptPath,
    `#!/usr/bin/env bun\n// claude:dangerouslyDisableSandbox: hands off to Apple Events\nconsole.log("hi");\n`,
  );

  unmarkedScriptPath = join(fixtureDir, "unmarked.ts");
  await Bun.write(unmarkedScriptPath, `#!/usr/bin/env bun\nconsole.log("hi");\n`);
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

function makeInput(toolInput: unknown, toolName = "Bash"): PreToolUseHookInput {
  return {
    hook_event_name: "PreToolUse",
    session_id: "s",
    transcript_path: "/dev/null",
    cwd: "/",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "t",
  };
}

const bashInput = (command: string) => makeInput({ command });

describe("tokenize", () => {
  test.each<[string, string, string[][]]>([
    [
      "operators",
      "bun a.ts && bun b.ts | jq .",
      [
        ["bun", "a.ts"],
        ["bun", "b.ts"],
        ["jq", "."],
      ],
    ],
    [
      "newlines",
      "cd /repo\nbun a.ts",
      [
        ["cd", "/repo"],
        ["bun", "a.ts"],
      ],
    ],
    ["line continuations", "bun a.ts \\\n  --pr 42", [["bun", "a.ts", "--pr", "42"]]],
    ["quoted separators", 'bun a.ts notes="one; two"', [["bun", "a.ts", "notes=one; two"]]],
    ["quoted newlines", 'bun a.ts notes="one\ntwo"', [["bun", "a.ts", "notes=one\ntwo"]]],
    ["subshells", "(bun a.ts)", [["bun", "a.ts"]]],
    ["redirections", "bun a.ts 2>&1", [["bun", "a.ts", "2>"], ["1"]]],
  ])("splits on %s", (_label, command, expected) => {
    expect(tokenize(command).map(({ tokens }) => tokens.map(tokenText))).toEqual(expected);
  });

  test("marks single-quoted text as unexpandable", () => {
    expect(tokenize(`bun '$P' "$Q"`)).toEqual([
      {
        depth: 0,
        tokens: [
          [{ text: "bun", expands: true }],
          [{ text: "$P", expands: false }],
          [{ text: "$Q", expands: true }],
        ],
      },
    ]);
  });
});

describe("extractScripts", () => {
  const base = "/base";

  test.each<[string, string, string[]]>([
    ["bun script arg", "bun watch.ts --pr 42", ["/base/watch.ts"]],
    ["node script arg", "node ./scripts/run.js", ["/base/scripts/run.js"]],
    ["env-prefixed bun script arg", "FOO=bar bun watch.ts", ["/base/watch.ts"]],
    ["script arg through a pipe", "bun watch.ts | jq .rate", ["/base/watch.ts"]],
    ["absolute bun script path", "bun /abs/path/watch.ts", ["/abs/path/watch.ts"]],
    ["directly executed script", "./scripts/run.sh foo", ["/base/scripts/run.sh"]],
    ["every script in a chain", "bun a.ts && bun b.ts", ["/base/a.ts", "/base/b.ts"]],
  ])("captures %s", (_label, command, expected) => {
    expect(extractScripts(command, base)).toEqual(expected);
  });

  test.each<[string, string]>([
    ["bun flag-bearing invocation", "bun --silent watch.ts"],
    ["plain binary", "git status"],
    ["absolute binary", "/usr/bin/touch x"],
  ])("finds no script in %s", (_label, command) => {
    expect(extractScripts(command, base)).toEqual([]);
  });

  test("resolves a relative path against a tracked cd", () => {
    expect(extractScripts("cd /repo\nbun plugins/mac/scripts/jxa.ts Things3", base)).toEqual([
      "/repo/plugins/mac/scripts/jxa.ts",
    ]);
  });

  test("resolves a relative path against a cd in the same chain", () => {
    expect(extractScripts("cd /repo && bun scripts/jxa.ts", base)).toEqual([
      "/repo/scripts/jxa.ts",
    ]);
  });

  test("finds the script behind a shell keyword", () => {
    expect(extractScripts("for id in a b; do bun run.ts $id; done", base)).toEqual([
      "/base/run.ts",
    ]);
  });

  test("expands home", () => {
    expect(extractScripts("bun ~/scripts/run.ts", base)).toEqual([
      join(homedir(), "scripts/run.ts"),
    ]);
  });

  test("expands a variable assigned earlier in the command", () => {
    expect(extractScripts("P=/abs/path\nbun $P/run.ts", base)).toEqual(["/abs/path/run.ts"]);
  });

  test("expands a braced variable from the environment", () => {
    expect(extractScripts(`bun \${HOME}/run.ts`, base)).toEqual([join(homedir(), "run.ts")]);
  });

  test("strips quotes around a script path", () => {
    expect(extractScripts('P=/abs/path\nbun "$P/run.ts"', base)).toEqual(["/abs/path/run.ts"]);
  });

  test("leaves a single-quoted variable unexpanded", () => {
    expect(extractScripts("P=/abs/path/run.ts\nbun '$P'", base)).toEqual(["/base/$P"]);
  });

  test("leaves a backslash-escaped variable unexpanded", () => {
    expect(extractScripts("P=/abs/path/run.ts\nbun \\$P", base)).toEqual(["/base/$P"]);
  });

  test("leaves a single-quoted tilde unexpanded", () => {
    expect(extractScripts("bun '~/run.ts'", base)).toEqual(["/base/~/run.ts"]);
  });

  test("keeps a command-prefix assignment out of later segments", () => {
    expect(extractScripts("P=/abs/path/run.ts echo hi\nbun $P", base)).toEqual(["/base/$P"]);
  });

  test("uses a command-prefix assignment for its own command", () => {
    expect(extractScripts("P=/abs/path bun $P/run.ts", base)).toEqual(["/abs/path/run.ts"]);
  });

  test("follows cd - back to the previous directory", () => {
    expect(extractScripts("cd /repo\ncd /other\ncd -\nbun run.ts", base)).toEqual(["/repo/run.ts"]);
  });

  test("unwinds a subshell cd at the closing paren", () => {
    expect(extractScripts("(cd /repo && bun a.ts)\nbun b.ts", base)).toEqual([
      "/repo/a.ts",
      "/base/b.ts",
    ]);
  });

  test("leaves an unresolved variable unexpanded", () => {
    expect(extractScripts("bun $NOT_A_REAL_VARIABLE_HERE/run.ts", base)).toEqual([
      "/base/$NOT_A_REAL_VARIABLE_HERE/run.ts",
    ]);
  });
});

describe("hasBypassMarker", () => {
  test("detects bypass marker in script", async () => {
    expect(await hasBypassMarker(markedScriptPath)).toBe(true);
  });

  test("returns false for script without marker", async () => {
    expect(await hasBypassMarker(unmarkedScriptPath)).toBe(false);
  });

  test("returns false for nonexistent path", async () => {
    expect(await hasBypassMarker("/nonexistent/path")).toBe(false);
  });

  test("returns false for a directory", async () => {
    expect(await hasBypassMarker(fixtureDir)).toBe(false);
  });
});

describe("processInput", () => {
  test("returns null on non-darwin", async () => {
    const result = await processInput(bashInput(`bun ${markedScriptPath}`), "linux");
    expect(result).toBeNull();
  });

  test.each([
    ["command is undefined", {}],
    ["command is empty", { command: "" }],
    ["command is not a string", { command: 42 }],
    ["tool input is not an object", "ls"],
    ["tool input is absent", undefined],
  ])("returns null when %s", async (_label, toolInput) => {
    expect(await processInput(makeInput(toolInput), "darwin")).toBeNull();
  });

  test("disables sandbox for marked bun script", async () => {
    const command = `bun ${markedScriptPath} --pr 42`;
    const input = bashInput(command);
    const result = await processInput(input, "darwin");
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { command, dangerouslyDisableSandbox: true },
      },
    });
  });

  test("does not disable sandbox for unmarked bun script", async () => {
    const result = await processInput(bashInput(`bun ${unmarkedScriptPath}`), "darwin");
    expect(result).toBeNull();
  });

  test("honors marker on second bun invocation in a chain", async () => {
    const input = bashInput(`bun ${unmarkedScriptPath} && bun ${markedScriptPath}`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for a marked script run directly", async () => {
    const result = await processInput(bashInput(`${markedScriptPath} --refresh`), "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("does not disable sandbox for an unmarked script run directly", async () => {
    const result = await processInput(bashInput(unmarkedScriptPath), "darwin");
    expect(result).toBeNull();
  });

  test("honors marker on second directly-run script in a chain", async () => {
    const input = bashInput(`${unmarkedScriptPath} && ${markedScriptPath}`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for a marked script on a later line", async () => {
    const input = bashInput(`cd /Users/ben/src/bendrucker/claude\nbun ${markedScriptPath} Things3`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for a marked script behind a variable", async () => {
    const input = bashInput(`P=${markedScriptPath}\nbun $P update id=abc completed=true`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("disables sandbox for a marked script inside a loop body", async () => {
    const input = bashInput(`for id in a b; do\n  bun ${markedScriptPath} -e "1"\ndone`);
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("resolves a relative script path against the session cwd", async () => {
    const input = { ...bashInput("bun marked.ts"), cwd: fixtureDir };
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });

  test("ignores a marked path that only appears inside an argument", async () => {
    const input = bashInput(`git commit -m "ran bun ${markedScriptPath} by hand"`);
    expect(await processInput(input, "darwin")).toBeNull();
  });

  test("processes Monitor tool input the same as Bash", async () => {
    const input = makeInput({ command: `bun ${markedScriptPath}` }, "Monitor");
    const result = await processInput(input, "darwin");
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      updatedInput: { dangerouslyDisableSandbox: true },
    });
  });
});

function ancestors(start: string): string[] {
  const dirs = [start];
  for (let dir = dirname(start); dir !== dirs.at(-1); dir = dirname(dir)) {
    dirs.push(dir);
  }
  return dirs;
}

async function holdsNodeModules(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).includes("node_modules");
  } catch {
    return false;
  }
}

describe.skipIf(process.platform !== "darwin")("dependency-free execution", () => {
  let isolatedDir: string;
  let hookCopy: string;

  beforeAll(async () => {
    isolatedDir = join(fixtureDir, "isolated");
    await mkdir(isolatedDir);
    hookCopy = join(isolatedDir, "sandbox.ts");
    await Bun.write(hookCopy, Bun.file(join(import.meta.dirname, "sandbox.ts")));
  });

  async function runHook(
    command: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", "--no-install", hookCopy], {
      cwd: isolatedDir,
      stdin: Buffer.from(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command },
        }),
      ),
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
    expect(await Promise.all(ancestors(isolatedDir).map(holdsNodeModules))).not.toContain(true);
  });

  test("emits the bypass for a marked script", async () => {
    const command = `bun ${markedScriptPath}`;
    expect(await runHook(command)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { command, dangerouslyDisableSandbox: true },
        },
      })}\n`,
    });
  });

  test("emits nothing for an unmarked script", async () => {
    expect(await runHook(`bun ${unmarkedScriptPath}`)).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "",
    });
  });
});
