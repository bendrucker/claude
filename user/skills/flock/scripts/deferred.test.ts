import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnRun } from "./exec";
import {
  daysBefore,
  deferredPath,
  drop,
  parseDeferrals,
  readDeferrals,
  record,
  staleKeys,
  updateDeferrals,
} from "./deferred";

const CLI = join(import.meta.dirname, "defer.ts");

async function scratch(): Promise<{ cache: string; path: string }> {
  const cache = await mkdtemp(join(tmpdir(), "flock-defer-"));
  return { cache, path: deferredPath({ XDG_CACHE_HOME: cache }) };
}

test("deferredPath honours XDG_CACHE_HOME and falls back to HOME", () => {
  expect(deferredPath({ XDG_CACHE_HOME: "/cache", HOME: "/home/ben" })).toBe(
    "/cache/claude/flock/deferred.json",
  );
  expect(deferredPath({ HOME: "/home/ben" })).toBe("/home/ben/.cache/claude/flock/deferred.json");
});

test("parseDeferrals fills in what an older file omitted", () => {
  expect(parseDeferrals('{"a":{"reason":"held","since":"2026-01-01"},"b":{}}')).toEqual({
    a: { reason: "held", since: "2026-01-01" },
    b: { reason: "no reason recorded", since: "9999-99-99" },
  });
  expect(parseDeferrals("")).toEqual({});
});

test("parseDeferrals rejects a file that is not a map of entries", () => {
  expect(() => parseDeferrals("[1,2]")).toThrow();
});

test("record and drop are pure updates", () => {
  const one = record({}, "redesign", "still working it", "2026-09-05");
  expect(one).toEqual({ redesign: { reason: "still working it", since: "2026-09-05" } });
  expect(drop(one, "redesign")).toEqual({});
  expect(one.redesign).toBeDefined();
});

test("staleKeys re-raises only entries older than the cutoff", () => {
  const deferrals = {
    fresh: { reason: "", since: "2026-09-01" },
    old: { reason: "", since: "2026-08-01" },
    undated: { reason: "", since: "9999-99-99" },
  };
  expect(staleKeys(deferrals, daysBefore(new Date("2026-09-05T00:00:00Z"), 14))).toEqual(["old"]);
});

describe("updateDeferrals", () => {
  test("a second write reads back the first", async () => {
    const { cache, path } = await scratch();
    try {
      await updateDeferrals(path, (current) => record(current, "a", "one", "2026-09-05"));
      await updateDeferrals(path, (current) => record(current, "b", "two", "2026-09-05"));
      expect(await readDeferrals(path)).toEqual({
        a: { reason: "one", since: "2026-09-05" },
        b: { reason: "two", since: "2026-09-05" },
      });
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  test("clears the lock when the mutation throws", async () => {
    const { cache, path } = await scratch();
    try {
      const failure = await updateDeferrals(path, () => {
        throw new Error("nope");
      }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);

      await updateDeferrals(path, (current) => record(current, "after", "recovered", "2026-09-05"));
      expect(Object.keys(await readDeferrals(path))).toEqual(["after"]);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  test("concurrent writers each keep their entry", async () => {
    const { cache, path } = await scratch();
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
    try {
      const runs = await Promise.all(
        keys.map((key) =>
          spawnRun(["bun", CLI, key, `reason ${key}`], {
            env: { ...process.env, XDG_CACHE_HOME: cache },
          }),
        ),
      );
      expect(runs.filter((run) => !run.ok).map((run) => run.stderr)).toEqual([]);
      expect(Object.keys(await readDeferrals(path)).toSorted()).toEqual(keys);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  test("--drop removes one entry and leaves the rest", async () => {
    const { cache, path } = await scratch();
    try {
      await updateDeferrals(path, (current) => record(current, "keep", "held", "2026-09-05"));
      await updateDeferrals(path, (current) => record(current, "gone", "held", "2026-09-05"));
      const dropped = await spawnRun(["bun", CLI, "--drop", "gone"], {
        env: { ...process.env, XDG_CACHE_HOME: cache },
      });

      expect(dropped.stdout.trim()).toBe("dropped: gone");
      expect(Object.keys(await readDeferrals(path))).toEqual(["keep"]);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
});
