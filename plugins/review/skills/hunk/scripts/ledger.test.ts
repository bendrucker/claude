import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLedgerDir, type HunkNote, Ledger } from "./ledger";

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
    return Ledger.open({ dir, repo: "owner/repo", branch, now });
  }

  test("round-trips records through persistence", async () => {
    const writer = await ledger();
    await writer.upsert(makeNote());

    const reader = await ledger();
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

  test("upsert, markResolved, isResolved", async () => {
    const led = await ledger();
    await led.upsert(makeNote());
    expect(led.isResolved("user:1")).toBe(false);

    await led.markResolved("user:1", { action: "applied", ref: "abc123" });
    expect(led.isResolved("user:1")).toBe(true);

    const record = led.get("user:1");
    expect(record?.action).toBe("applied");
    expect(record?.ref).toBe("abc123");
  });

  test("upsert does not un-resolve an already-resolved note", async () => {
    const led = await ledger();
    await led.upsert(makeNote());
    await led.markResolved("user:1");
    expect(led.isResolved("user:1")).toBe(true);

    await led.upsert(makeNote({ body: "edited body" }));
    expect(led.isResolved("user:1")).toBe(true);
    expect(led.get("user:1")?.body).toBe("edited body");
  });

  test("first sight defaults resolved=false", async () => {
    const led = await ledger();
    await led.upsert(makeNote());
    expect(led.open()).toHaveLength(1);
    expect(led.resolved()).toHaveLength(0);
  });

  test("open and resolved partition records", async () => {
    const led = await ledger();
    await led.upsert(makeNote({ noteId: "user:1" }));
    await led.upsert(makeNote({ noteId: "user:2" }));
    await led.markResolved("user:2");

    expect(led.open().map((r) => r.noteId)).toEqual(["user:1"]);
    expect(led.resolved().map((r) => r.noteId)).toEqual(["user:2"]);
  });

  test("reconcile detects an orphaned entry", async () => {
    const led = await ledger();
    await led.upsert(makeNote({ noteId: "user:1" }));
    await led.upsert(makeNote({ noteId: "user:2" }));

    const { orphaned } = led.reconcile(["user:1"]);
    expect(orphaned.map((r) => r.noteId)).toEqual(["user:2"]);
  });

  test("reconcile reports nothing when all notes are present", async () => {
    const led = await ledger();
    await led.upsert(makeNote({ noteId: "user:1" }));
    expect(led.reconcile(["user:1", "user:99"]).orphaned).toEqual([]);
  });

  test("different branches use different files", async () => {
    const a = await ledger("feature-a");
    const b = await ledger("feature-b");
    await a.upsert(makeNote({ noteId: "user:1" }));

    expect(a.filePath).not.toBe(b.filePath);
    expect(b.get("user:1")).toBeUndefined();
    expect(b.all()).toHaveLength(0);
  });

  test("anchors to old side when newRange is null", async () => {
    const led = await ledger();
    await led.upsert(makeNote({ noteId: "user:1", newRange: null, oldRange: [5, 8] }));
    expect(led.get("user:1")?.anchor).toEqual({ side: "old", line: 5 });
  });

  test("upsert throws when note has neither range", async () => {
    const led = await ledger();
    expect(led.upsert(makeNote({ newRange: null, oldRange: null }))).rejects.toThrow(
      "note has no anchor",
    );
  });

  test("markResolved throws for unknown note", async () => {
    const led = await ledger();
    expect(led.markResolved("user:404")).rejects.toThrow("No ledger record");
  });

  test("loads tolerantly when file is missing", async () => {
    const led = await ledger();
    expect(led.all()).toEqual([]);
  });

  test("sanitizes repo and branch into the filename", async () => {
    const led = await Ledger.open({
      dir,
      repo: "owner/repo",
      branch: "feature/foo bar",
      now,
    });
    await led.upsert(makeNote());
    const name = led.filePath.slice(dir.length + 1);
    expect(name).toBe("owner-repo__feature-foo-bar.json");
  });

  test("persists pretty-printed JSON with trailing newline", async () => {
    const led = await ledger();
    await led.upsert(makeNote());
    const raw = await Bun.file(led.filePath).text();
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "records"');
  });

  test("defaultLedgerDir points under the plugin data dir", () => {
    expect(defaultLedgerDir()).toContain(
      join(".claude", "plugins", "data", "claude-review", "hunk-ledger"),
    );
  });
});
