import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSandboxFailure, looksSandboxAttributable } from "./transcript";

const scratch = mkdtempSync(join(tmpdir(), "sandbox-discipline-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

let counter = 0;

type Call = { id: string; command: string; bypassed?: boolean; result: string };

async function transcript(calls: Call[]): Promise<string> {
  const lines: string[] = [];
  for (const call of calls) {
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: call.id,
              name: "Bash",
              input: {
                command: call.command,
                ...(call.bypassed ? { dangerouslyDisableSandbox: true } : {}),
              },
            },
          ],
        },
      }),
    );
    lines.push(
      JSON.stringify({
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: call.id, content: call.result }],
        },
      }),
    );
  }

  counter += 1;
  const path = join(scratch, `t${counter}.jsonl`);
  await Bun.write(path, `${lines.join("\n")}\n`);
  return path;
}

describe("looksSandboxAttributable", () => {
  test.each<[string, boolean]>([
    ["mktemp: mkstemp failed on /var/tmp/x: Operation not permitted", true],
    ["EPERM: failed to link binaries", true],
    ["getaddrinfo ENOTFOUND api.github.com", true],
    ["sandbox-exec: sandbox_apply: Operation not permitted", true],
    ["/tmp/x.sh: line 5: /tmp/y.json: Permission denied", true],
    ["error: cannot write to read-only file system", true],
    ["execution error: An error occurred. (-10004)", true],
    ["osascript: Not authorized to send Apple events to Things3", true],
    ["fatal: not a git repository", false],
    ["exit code 1 after 10004 rows", false],
    ["TypeError: undefined is not a function", false],
    ["", false],
  ])("%p -> %p", (text, expected) => {
    expect(looksSandboxAttributable(text)).toBe(expected);
  });
});

describe("findSandboxFailure", () => {
  test("finds a matching sandboxed failure", async () => {
    const path = await transcript([
      { id: "a", command: "bun scripts/x.ts", result: "x.ts: Operation not permitted" },
    ]);
    const failure = await findSandboxFailure(path, new Set(["bun"]));
    expect(failure?.command).toBe("bun scripts/x.ts");
    expect(failure?.error).toContain("Operation not permitted");
  });

  test.each<{ name: string; call: Call; found: boolean }>([
    {
      name: "matches through a cd preamble on the failing side",
      call: { id: "a", command: "cd /repo && bun scripts/x.ts", result: "EPERM: denied" },
      found: true,
    },
    {
      name: "ignores a failure from a different verb",
      call: { id: "a", command: "npm install", result: "EPERM: operation not permitted" },
      found: false,
    },
    {
      name: "ignores a non-sandbox failure of the same verb",
      call: { id: "a", command: "bun scripts/x.ts", result: "error: Cannot find module './y'" },
      found: false,
    },
    {
      name: "ignores a failure from an already-bypassed run",
      call: {
        id: "a",
        command: "bun scripts/x.ts",
        bypassed: true,
        result: "Operation not permitted",
      },
      found: false,
    },
  ])("$name", async ({ call, found }) => {
    const path = await transcript([call]);
    const failure = await findSandboxFailure(path, new Set(["bun"]));
    expect(failure !== null).toBe(found);
  });

  test("ignores a failure older than the recent window", async () => {
    const calls: Call[] = [
      { id: "old", command: "bun scripts/x.ts", result: "Operation not permitted" },
    ];
    for (let i = 0; i < 45; i++) {
      calls.push({ id: `n${i}`, command: "ls", result: "ok" });
    }
    const path = await transcript(calls);
    expect(await findSandboxFailure(path, new Set(["bun"]))).toBeNull();
  });

  test("returns null for an empty verb set", async () => {
    const path = await transcript([
      { id: "a", command: "bun scripts/x.ts", result: "Operation not permitted" },
    ]);
    expect(await findSandboxFailure(path, new Set())).toBeNull();
  });

  test("returns null for a missing transcript", async () => {
    expect(await findSandboxFailure(join(scratch, "missing.jsonl"), new Set(["bun"]))).toBeNull();
  });

  test("survives malformed lines", async () => {
    const path = join(scratch, "malformed.jsonl");
    await Bun.write(path, 'not json\n{"type":"user"}\n{"message":{"content":"text"}}\n');
    expect(await findSandboxFailure(path, new Set(["bun"]))).toBeNull();
  });

  test("drops the partial first record when reading a truncated tail", async () => {
    const path = await transcript([
      { id: "a", command: "bun scripts/x.ts", result: "Operation not permitted" },
      { id: "b", command: "git status", result: "clean" },
    ]);
    const found = await findSandboxFailure(path, new Set(["bun"]), { tailBytes: 120 });
    expect(found).toBeNull();
  });

  test("reads structured tool_result content blocks", async () => {
    const path = join(scratch, "blocks.jsonl");
    await Bun.write(
      path,
      `${JSON.stringify({
        message: {
          content: [
            { type: "tool_use", id: "a", name: "Bash", input: { command: "bun x.ts" } },
            {
              type: "tool_result",
              tool_use_id: "a",
              content: [{ type: "text", text: "Operation not permitted" }],
            },
          ],
        },
      })}\n`,
    );
    expect(await findSandboxFailure(path, new Set(["bun"]))).not.toBeNull();
  });
});
