import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HunkNote, Ledger, defaultLedgerDir } from "./ledger";

function makeNote(overrides: Partial<HunkNote> = {}): HunkNote {
  return {
    noteId: "user:1",
    source: "user",
    filePath: "src/index.ts",
    newRange: [10, 12],
    oldRange: null,
    body: "needs a guard clause",
    ...overrides,
  };
}

describe("Ledger", () => {
  let dir: string;
  const now = () => "2026-06-01T00:00:00.000Z";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ledger-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function ledger(branch = "feature") {
    return new Ledger({ dir, repo: "owner/repo", branch, now });
  }

  test("round-trips records through persistence", () => {
    const writer = ledger();
    writer.upsert(makeNote());

    const reader = ledger();
    const record = reader.get("user:1");
    expect(record).toEqual({
      noteId: "user:1",
      filePath: "src/index.ts",
      anchor: { side: "new", line: 10 },
      body: "needs a guard clause",
      resolved: false,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  test("upsert, markResolved, isResolved", () => {
    const led = ledger();
    led.upsert(makeNote());
    expect(led.isResolved("user:1")).toBe(false);

    led.markResolved("user:1", { action: "applied", ref: "abc123" });
    expect(led.isResolved("user:1")).toBe(true);

    const record = led.get("user:1");
    expect(record?.action).toBe("applied");
    expect(record?.ref).toBe("abc123");
  });

  test("upsert does not un-resolve an already-resolved note", () => {
    const led = ledger();
    led.upsert(makeNote());
    led.markResolved("user:1");
    expect(led.isResolved("user:1")).toBe(true);

    led.upsert(makeNote({ body: "edited body" }));
    expect(led.isResolved("user:1")).toBe(true);
    expect(led.get("user:1")?.body).toBe("edited body");
  });

  test("first sight defaults resolved=false", () => {
    const led = ledger();
    led.upsert(makeNote());
    expect(led.open()).toHaveLength(1);
    expect(led.resolved()).toHaveLength(0);
  });

  test("open and resolved partition records", () => {
    const led = ledger();
    led.upsert(makeNote({ noteId: "user:1" }));
    led.upsert(makeNote({ noteId: "user:2" }));
    led.markResolved("user:2");

    expect(led.open().map((r) => r.noteId)).toEqual(["user:1"]);
    expect(led.resolved().map((r) => r.noteId)).toEqual(["user:2"]);
  });

  test("reconcile detects an orphaned entry", () => {
    const led = ledger();
    led.upsert(makeNote({ noteId: "user:1" }));
    led.upsert(makeNote({ noteId: "user:2" }));

    const { orphaned } = led.reconcile(["user:1"]);
    expect(orphaned.map((r) => r.noteId)).toEqual(["user:2"]);
  });

  test("reconcile reports nothing when all notes are present", () => {
    const led = ledger();
    led.upsert(makeNote({ noteId: "user:1" }));
    expect(led.reconcile(["user:1", "user:99"]).orphaned).toEqual([]);
  });

  test("different branches use different files", () => {
    const a = ledger("feature-a");
    const b = ledger("feature-b");
    a.upsert(makeNote({ noteId: "user:1" }));

    expect(a.filePath).not.toBe(b.filePath);
    expect(b.get("user:1")).toBeUndefined();
    expect(b.all()).toHaveLength(0);
  });

  test("anchors to old side when newRange is null", () => {
    const led = ledger();
    led.upsert(makeNote({ noteId: "user:1", newRange: null, oldRange: [5, 8] }));
    expect(led.get("user:1")?.anchor).toEqual({ side: "old", line: 5 });
  });

  test("upsert throws when note has neither range", () => {
    const led = ledger();
    expect(() => led.upsert(makeNote({ newRange: null, oldRange: null }))).toThrow(
      "note has no anchor",
    );
  });

  test("markResolved throws for unknown note", () => {
    const led = ledger();
    expect(() => led.markResolved("user:404")).toThrow("No ledger record");
  });

  test("loads tolerantly when file is missing", () => {
    const led = ledger();
    expect(led.all()).toEqual([]);
  });

  test("sanitizes repo and branch into the filename", () => {
    const led = new Ledger({
      dir,
      repo: "owner/repo",
      branch: "feature/foo bar",
      now,
    });
    led.upsert(makeNote());
    const name = led.filePath.slice(dir.length + 1);
    expect(name).toBe("owner-repo__feature-foo-bar.json");
  });

  test("persists pretty-printed JSON with trailing newline", () => {
    const led = ledger();
    led.upsert(makeNote());
    const raw = readFileSync(led.filePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "records"');
  });

  test("defaultLedgerDir points under the plugin data dir", () => {
    expect(defaultLedgerDir()).toContain(
      join(".claude", "plugins", "data", "claude-review", "hunk-ledger"),
    );
  });
});
