import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLedgerDir, Ledger, type TuicrComment } from "./ledger";

function makeComment(overrides: Partial<TuicrComment> = {}): TuicrComment {
  return {
    id: "c1",
    location: "src/index.ts:10-12",
    path: "src/index.ts",
    start_line: 10,
    end_line: 12,
    side: "new",
    comment_type: "issue",
    lifecycle_state: "local_draft",
    content: "needs a guard clause",
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
    await writer.upsert(makeComment());

    const reader = await ledger();
    const record = reader.get("c1");
    expect(record).toEqual({
      id: "c1",
      path: "src/index.ts",
      anchor: { side: "new", line: 10 },
      content: "needs a guard clause",
      resolved: false,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  test("upsert, markResolved, isResolved", async () => {
    const led = await ledger();
    await led.upsert(makeComment());
    expect(led.isResolved("c1")).toBe(false);

    await led.markResolved("c1", { action: "applied", ref: "abc123" });
    expect(led.isResolved("c1")).toBe(true);

    const record = led.get("c1");
    expect(record?.action).toBe("applied");
    expect(record?.ref).toBe("abc123");
  });

  test("upsert does not un-resolve an already-resolved comment", async () => {
    const led = await ledger();
    await led.upsert(makeComment());
    await led.markResolved("c1");
    expect(led.isResolved("c1")).toBe(true);

    await led.upsert(makeComment({ content: "edited content" }));
    expect(led.isResolved("c1")).toBe(true);
    expect(led.get("c1")?.content).toBe("edited content");
  });

  test("first sight defaults resolved=false", async () => {
    const led = await ledger();
    await led.upsert(makeComment());
    expect(led.open()).toHaveLength(1);
    expect(led.resolved()).toHaveLength(0);
  });

  test("open and resolved partition records", async () => {
    const led = await ledger();
    await led.upsert(makeComment({ id: "c1" }));
    await led.upsert(makeComment({ id: "c2" }));
    await led.markResolved("c2");

    expect(led.open().map((r) => r.id)).toEqual(["c1"]);
    expect(led.resolved().map((r) => r.id)).toEqual(["c2"]);
  });

  test("reconcile detects an orphaned entry", async () => {
    const led = await ledger();
    await led.upsert(makeComment({ id: "c1" }));
    await led.upsert(makeComment({ id: "c2" }));

    const { orphaned } = led.reconcile(["c1"]);
    expect(orphaned.map((r) => r.id)).toEqual(["c2"]);
  });

  test("reconcile reports nothing when all comments are present", async () => {
    const led = await ledger();
    await led.upsert(makeComment({ id: "c1" }));
    expect(led.reconcile(["c1", "c99"]).orphaned).toEqual([]);
  });

  test("different branches use different files", async () => {
    const a = await ledger("feature-a");
    const b = await ledger("feature-b");
    await a.upsert(makeComment({ id: "c1" }));

    expect(a.filePath).not.toBe(b.filePath);
    expect(b.get("c1")).toBeUndefined();
    expect(b.all()).toHaveLength(0);
  });

  test("anchors to old side when tuicr stamps it", async () => {
    const led = await ledger();
    await led.upsert(makeComment({ id: "c1", start_line: 5, end_line: 8, side: "old" }));
    expect(led.get("c1")?.anchor).toEqual({ side: "old", line: 5 });
  });

  test("upsert throws when comment has no line anchor", async () => {
    const led = await ledger();
    expect(led.upsert(makeComment({ path: null, start_line: null }))).rejects.toThrow(
      "comment has no anchor",
    );
  });

  test("markResolved throws for unknown comment", async () => {
    const led = await ledger();
    expect(led.markResolved("c404")).rejects.toThrow("No ledger record");
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
    await led.upsert(makeComment());
    const name = led.filePath.slice(dir.length + 1);
    expect(name).toBe("owner-repo__feature-foo-bar.json");
  });

  test("persists pretty-printed JSON with trailing newline", async () => {
    const led = await ledger();
    await led.upsert(makeComment());
    const raw = await Bun.file(led.filePath).text();
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "records"');
  });

  test("defaultLedgerDir points under the plugin data dir", () => {
    expect(defaultLedgerDir()).toContain(
      join(".claude", "plugins", "data", "claude-review", "tuicr-ledger"),
    );
  });
});
