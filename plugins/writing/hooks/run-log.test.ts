import { describe, expect, it, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunLog, type RunLogEntry, resolveLogPath } from "./run-log";

function entry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    ts: "2026-07-09T00:00:00.000Z",
    session_id: "test-session",
    tool: "Write",
    ext: "md",
    duration_ms: 5,
    outcome: "silent",
    ...overrides,
  };
}

describe("resolveLogPath", () => {
  it("defaults to the home-dir log when unset", () => {
    expect(resolveLogPath(undefined)).toBe(
      join(homedir(), ".claude", "writing-hooks", "log.jsonl"),
    );
  });

  test.each<[string]>([["0"], ["false"], ["off"], ["OFF"]])("disables for %p", (value) => {
    expect(resolveLogPath(value)).toBeNull();
  });

  test.each<[string]>([["1"], ["true"], ["on"]])("stays on the default path for %p", (value) => {
    expect(resolveLogPath(value)).toBe(join(homedir(), ".claude", "writing-hooks", "log.jsonl"));
  });

  it("treats any other value as a destination override", () => {
    expect(resolveLogPath("/custom/dir/hooks.jsonl")).toBe("/custom/dir/hooks.jsonl");
  });
});

describe("appendRunLog", () => {
  it("creates the directory and appends one JSONL line per run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-log-"));
    const path = join(dir, "nested", "log.jsonl");

    appendRunLog(entry({ outcome: "context", category: "numbering" }), path);
    appendRunLog(entry({ outcome: "silent", suppressed: true, category: "numbering" }), path);

    const lines = (await Bun.file(path).text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      outcome: "context",
      category: "numbering",
      tool: "Write",
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ suppressed: true });
  });

  it("does nothing when logging is disabled", () => {
    expect(() => appendRunLog(entry(), null)).not.toThrow();
  });

  it("rotates once the file exceeds the size cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-log-"));
    const path = join(dir, "log.jsonl");
    const line = `${JSON.stringify(entry())}\n`;
    const filler = line.repeat(Math.ceil((5 * 1024 * 1024 + 1) / line.length));
    await Bun.write(path, filler);

    appendRunLog(entry({ outcome: "deny" }), path);

    const rotated = Bun.file(`${path}.1`);
    expect(await rotated.exists()).toBe(true);
    expect(rotated.size).toBe(filler.length);
    const fresh = (await Bun.file(path).text()).trim().split("\n");
    expect(fresh).toHaveLength(1);
    expect(JSON.parse(fresh[0] ?? "")).toMatchObject({ outcome: "deny" });
  });
});
