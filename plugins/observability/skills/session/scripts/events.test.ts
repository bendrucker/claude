import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emit, errorClass } from "./events";

const refresh = { event: "refresh", ok: true, ms: 12.4, detail: { outcome: "indexed" } } as const;

describe("emit", () => {
  it("files a run without a session under cli, with no session id", async () => {
    const config = mkdtempSync(join(tmpdir(), "events-"));
    await emit(refresh, { CLAUDE_CONFIG_DIR: config });
    const [file] = readdirSync(join(config, "mod-events", "cli"));
    const record: unknown = JSON.parse(
      await Bun.file(join(config, "mod-events", "cli", file ?? "")).text(),
    );
    expect(record).toMatchObject({
      event_name: "session-index.refresh",
      severity_text: "INFO",
      attributes: { outcome: "indexed", duration_ms: 12 },
      scope: { name: "session-index" },
    });
    expect(record).not.toHaveProperty(["attributes", "session.id"]);
  });

  it("files a session's run under its id", async () => {
    const config = mkdtempSync(join(tmpdir(), "events-"));
    await emit(refresh, { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_SESSION_ID: "abc-123" });
    expect(readdirSync(join(config, "mod-events"))).toEqual(["abc-123"]);
  });

  it("writes nothing under bun test", async () => {
    const config = mkdtempSync(join(tmpdir(), "events-"));
    await emit(refresh, { CLAUDE_CONFIG_DIR: config, NODE_ENV: "test" });
    expect(readdirSync(config)).toEqual([]);
  });
});

describe("errorClass", () => {
  it.each([
    [new Error('Binder Error: Referenced column "input" not found'), "Binder Error"],
    [new Error("duckdb timed out after 5000ms\nmore"), "duckdb timed out after 5000ms"],
    ["IO Error: Could not set lock on file", "IO Error"],
  ])("classifies %p", (error, expected) => {
    expect(errorClass(error)).toBe(expected);
  });
});
