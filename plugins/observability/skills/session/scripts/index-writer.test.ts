import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { type Database, getDb, sessionDbPath } from "./db";
import type { IndexEvent } from "./events";
import {
  checkStamp,
  refreshIndex,
  stampPath,
  type WriterDeps,
  withReader,
  withWriter,
} from "./index-writer";
import { type HeldLock, holdLock } from "./lock-holder";

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "sessions");
const LOCK_ERROR =
  'IO Error: Could not set lock on file "session.duckdb": Conflicting lock is held';

let dataDir: string;
let importsDir: string;
let events: IndexEvent[];
let held: HeldLock | undefined;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "index-writer-"));
  dataDir = join(tmp, "data");
  importsDir = join(tmp, "imports");
  events = [];
  held = undefined;
});

afterEach(async () => {
  await held?.release();
  await rm(join(dataDir, ".."), { recursive: true, force: true });
});

function deps(overrides: WriterDeps = {}): WriterDeps {
  return {
    emit: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    retryDelayMs: 1,
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String(error);
  }
  throw new Error("expected a rejection");
}

const index = () => ({ projectsDir: fixturesDir, importsDir });
const outcomes = () => events.map((e) => e.detail.outcome);

async function rawCount(db: Database): Promise<number> {
  const [row] = await db.query("SELECT COUNT(*) AS n FROM raw", z.object({ n: z.bigint() }));
  return Number(row?.n ?? 0n);
}

describe("refreshIndex", () => {
  it("indexes, stamps, and records the outcome", async () => {
    expect(await refreshIndex(dataDir, { index: index() }, deps())).toBe("indexed");

    expect(await Bun.file(stampPath(dataDir)).exists()).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "refresh", ok: true, detail: { outcome: "indexed" } });
    expect(events[0]?.detail.changed_files).toBeGreaterThan(0);
  });

  it("carries the trigger on the event", async () => {
    await refreshIndex(dataDir, { index: index(), trigger: "import" }, deps());
    expect(events[0]?.detail).toMatchObject({ outcome: "indexed", trigger: "import" });
  });

  it("compacts on request", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    expect(await refreshIndex(dataDir, { index: index(), compact: true }, deps())).toBe(
      "compacted",
    );
    expect(outcomes()).toEqual(["indexed", "compacted"]);
  });

  it("yields to a writer holding an existing index", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    await rm(stampPath(dataDir));
    held = await holdLock(dataDir, "READ_WRITE");

    expect(await refreshIndex(dataDir, { index: index(), yieldToLock: true }, deps())).toBe(
      "lock-yield",
    );
    expect(outcomes()).toEqual(["indexed", "lock-yield"]);
    expect(await Bun.file(stampPath(dataDir)).exists()).toBe(false);
  });

  it("fails on a held lock when not yielding", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    held = await holdLock(dataDir, "READ_WRITE");

    expect(await rejection(refreshIndex(dataDir, { index: index() }, deps()))).toMatch(/lock/);
    expect(outcomes()).toEqual(["indexed", "error"]);
    expect(events[1]).toMatchObject({ ok: false, detail: { error: "IO Error" } });
  });

  it("fails rather than yields when there is no index to yield to", async () => {
    const open = () => Promise.reject(new Error(LOCK_ERROR));
    expect(await rejection(refreshIndex(dataDir, { yieldToLock: true }, deps({ open })))).toMatch(
      /lock/,
    );
    expect(outcomes()).toEqual(["error"]);
  });

  it("retries a lock that clears", async () => {
    let attempts = 0;
    const open = (dir: string) =>
      ++attempts < 3 ? Promise.reject(new Error(LOCK_ERROR)) : getDb(dir);

    expect(await refreshIndex(dataDir, { index: index() }, deps({ open }))).toBe("indexed");
    expect(attempts).toBe(3);
  });

  it("records an open failure without retrying it", async () => {
    let attempts = 0;
    const open = () => {
      attempts++;
      return Promise.reject(new Error("IO Error: Permission denied"));
    };

    expect(await rejection(refreshIndex(dataDir, {}, deps({ open })))).toMatch(/Permission/);
    expect(attempts).toBe(1);
    expect(outcomes()).toEqual(["error"]);
  });

  it("closes the connection when indexing fails", async () => {
    let closed = false;
    const broken: Database = {
      run: () => Promise.reject(new Error("Binder Error: nope")),
      query: () => Promise.reject(new Error("Binder Error: nope")),
      close: () => {
        closed = true;
      },
    };

    expect(
      await rejection(refreshIndex(dataDir, {}, deps({ open: () => Promise.resolve(broken) }))),
    ).toMatch(/Binder/);
    expect(closed).toBe(true);
    expect(events[0]?.detail).toMatchObject({ outcome: "error", error: "Binder Error" });
    expect(await Bun.file(stampPath(dataDir)).exists()).toBe(false);
  });
});

describe("checkStamp", () => {
  it.each<{ name: string; maxAgeMs: number; stamp: boolean; index: boolean; fresh: boolean }>([
    {
      name: "a young stamp over an index",
      maxAgeMs: 60_000,
      stamp: true,
      index: true,
      fresh: true,
    },
    { name: "an expired stamp", maxAgeMs: 0, stamp: true, index: true, fresh: false },
    { name: "no stamp", maxAgeMs: 60_000, stamp: false, index: true, fresh: false },
    { name: "a stamp with no index", maxAgeMs: 60_000, stamp: true, index: false, fresh: false },
  ])("reads $name as fresh=$fresh", async ({ maxAgeMs, stamp, index: hasIndex, fresh }) => {
    mkdirSync(dataDir, { recursive: true });
    if (hasIndex) await Bun.write(sessionDbPath(dataDir), "");
    if (stamp) await Bun.write(stampPath(dataDir), "");

    expect(await checkStamp(dataDir, maxAgeMs, deps())).toBe(fresh);
    expect(outcomes()).toEqual(fresh ? ["stamp-fresh"] : []);
  });

  it("answers while a writer holds the index", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    held = await holdLock(dataDir, "READ_WRITE");
    expect(await checkStamp(dataDir, 60_000, deps())).toBe(true);
  });
});

describe("withWriter", () => {
  it("ensures the schema on a fresh directory", async () => {
    expect(await withWriter(dataDir, rawCount, deps())).toBe(0);
  });

  it("closes the connection when the work fails", async () => {
    expect(
      await rejection(withWriter(dataDir, () => Promise.reject(new Error("boom")), deps())),
    ).toMatch("boom");
    expect(await withWriter(dataDir, rawCount, deps())).toBe(0);
  });
});

describe("withReader", () => {
  it("returns undefined when there is no index", async () => {
    expect(await withReader(dataDir, rawCount)).toBeUndefined();
    expect(await Bun.file(sessionDbPath(dataDir)).exists()).toBe(false);
  });

  it("reads beside another reader and refuses writes", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    held = await holdLock(dataDir, "READ_ONLY");

    expect(await withReader(dataDir, rawCount)).toBeGreaterThan(0);
    expect(await rejection(withReader(dataDir, (db) => db.run("CREATE TABLE t (i INT)")))).toMatch(
      /read-only/i,
    );
  });

  it("returns undefined while a writer holds the index", async () => {
    await refreshIndex(dataDir, { index: index() }, deps());
    held = await holdLock(dataDir, "READ_WRITE");
    expect(await withReader(dataDir, rawCount)).toBeUndefined();
  });
});
