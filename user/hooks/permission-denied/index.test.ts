import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filename, type PermissionDeniedInput, record, target, write } from "./index";

const STAMP = "2026-08-01T12:00:00.000Z";

test.each<{ name: string; input: Record<string, unknown> | undefined; expected: string }>([
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
])("target: $name", ({ input, expected }) => {
  expect(target(input)).toBe(expected);
});

test("record captures the denial", () => {
  const input: PermissionDeniedInput = {
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
  "timestamp": "2026-08-01T12:00:00.000Z",
  "tool_name": "Bash",
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
  "timestamp": "2026-08-01T12:00:00.000Z",
  "tool_name": "",
}
`);
});

test.each<{ name: string; input: PermissionDeniedInput; expected: string }>([
  {
    name: "sorts by time and stays unique per call",
    input: { tool_use_id: "toolu_01ABC" },
    expected: "2026-08-01T12-00-00.000Z-toolu_01ABC.json",
  },
  {
    name: "falls back when the payload carries no tool_use_id",
    input: {},
    expected: "2026-08-01T12-00-00.000Z-unknown.json",
  },
  {
    name: "keeps an untrusted id inside a single path component",
    input: { tool_use_id: "../../escape" },
    expected: "2026-08-01T12-00-00.000Z-..-..-escape.json",
  },
])("filename: $name", ({ input, expected }) => {
  expect(filename(input, STAMP)).toBe(expected);
});

test("write creates the directory and stores one file per denial", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "denials-")), "nested");
  await write(dir, { tool_name: "Bash", tool_use_id: "a", tool_input: { command: "x" } }, STAMP);
  await write(dir, { tool_name: "Edit", tool_use_id: "b", tool_input: { file_path: "/y" } }, STAMP);

  const files = readdirSync(dir).sort();
  expect(files).toHaveLength(2);
  const first = await Bun.file(join(dir, files[0])).json();
  expect(first.target).toBe("x");
});
