import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionDeniedHookInput } from "@anthropic-ai/claude-agent-sdk";
import { append, record, resolveLogPath, target } from "./index";

const STAMP = "2026-08-01T12:00:00.000Z";

function logPath(): string {
  return join(mkdtempSync(join(tmpdir(), "denials-")), "nested", "log.jsonl");
}

test.each<{ name: string; input: unknown; expected: string }>([
  {
    name: "Bash command",
    input: { command: "rm -rf build", description: "clean" },
    expected: "rm -rf build",
  },
  { name: "Edit file path", input: { file_path: "/repo/src/a.ts" }, expected: "/repo/src/a.ts" },
  { name: "WebFetch url", input: { url: "https://example.com" }, expected: "https://example.com" },
  { name: "field precedence", input: { file_path: "/a", command: "ls" }, expected: "ls" },
  { name: "no known field", input: { model: "opus" }, expected: '{"model":"opus"}' },
  { name: "empty string is not a target", input: { command: "", file_path: "/a" }, expected: "/a" },
  { name: "missing input", input: undefined, expected: "" },
  { name: "non-object input", input: "raw", expected: "" },
])("target: $name", ({ input, expected }) => {
  expect(target(input)).toBe(expected);
});

test("record captures the denial", () => {
  const input: Partial<PermissionDeniedHookInput> = {
    session_id: "abc123",
    cwd: "/repo",
    tool_name: "Bash",
    tool_input: { command: "git push --force origin main" },
    reason: "Blocked by classifier",
  };
  expect(record(input, STAMP)).toMatchInlineSnapshot(`
{
  "cwd": "/repo",
  "reason": "Blocked by classifier",
  "session_id": "abc123",
  "target": "git push --force origin main",
  "tool": "Bash",
  "ts": "2026-08-01T12:00:00.000Z",
}
`);
});

test("record tolerates a payload missing every field", () => {
  expect(record({}, STAMP)).toMatchInlineSnapshot(`
{
  "cwd": "",
  "reason": "",
  "session_id": "",
  "target": "",
  "tool": "",
  "ts": "2026-08-01T12:00:00.000Z",
}
`);
});

test.each<{ name: string; env: string | undefined; expected: string | null }>([
  { name: "unset defaults to on", env: undefined, expected: "DEFAULT" },
  { name: "0 disables", env: "0", expected: null },
  { name: "false disables", env: "false", expected: null },
  { name: "OFF disables case-insensitively", env: "OFF", expected: null },
  { name: "1 keeps the default path", env: "1", expected: "DEFAULT" },
  { name: "empty string keeps the default path", env: "", expected: "DEFAULT" },
  {
    name: "any other value is a path override",
    env: "/custom/log.jsonl",
    expected: "/custom/log.jsonl",
  },
])("resolveLogPath: $name", ({ env, expected }) => {
  const resolved = resolveLogPath(env);
  if (expected === "DEFAULT") {
    expect(resolved).toEndWith(".claude/auto-mode-denials.jsonl");
  } else {
    expect(resolved).toBe(expected);
  }
});

test("append writes one JSON line per denial and creates the directory", async () => {
  const path = logPath();
  append(record({ tool_name: "Bash", tool_input: { command: "a" } }, STAMP), path);
  append(record({ tool_name: "Edit", tool_input: { file_path: "/b" } }, STAMP), path);

  const lines = (await Bun.file(path).text()).trimEnd().split("\n");
  expect(lines.map((line) => JSON.parse(line).target)).toEqual(["a", "/b"]);
});

test("append writes nothing when logging is disabled", () => {
  expect(() => append(record({}, STAMP), null)).not.toThrow();
});

test("append rotates once the log passes the size cap", async () => {
  const path = logPath();
  const filler = "x".repeat(1024);
  append({ ...record({}, STAMP), target: filler }, path);
  await Bun.write(path, filler.repeat(6 * 1024));

  append(record({ tool_name: "Bash", tool_input: { command: "after" } }, STAMP), path);

  expect(await Bun.file(`${path}.1`).exists()).toBe(true);
  const lines = (await Bun.file(path).text()).trimEnd().split("\n");
  expect(lines.map((line) => JSON.parse(line).target)).toEqual(["after"]);
});
