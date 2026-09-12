import { describe, expect, test } from "bun:test";
import { due, nextBoundary, nextDigest, parseDuration } from "./release";
import type { LedgerRow, Presence } from "./types";

const PRESENCE: Presence = {
  focus: null,
  busyUntil: null,
  activeNode: "studio",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseDuration", () => {
  test.each([
    ["30s", 30_000],
    ["3m", 180_000],
    ["2h", 7_200_000],
    ["1d", 86_400_000],
  ])("parses %s", (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });

  test("rejects an unrecognized duration", () => {
    expect(() => parseDuration("3x")).toThrow("invalid duration: 3x");
  });
});

describe("nextBoundary", () => {
  test("is the top of the next hour with no calendar event", () => {
    const now = new Date("2026-01-01T09:15:00.000Z");
    expect(nextBoundary(now, PRESENCE).toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  test("is the calendar event end when it comes before the next hour", () => {
    const now = new Date("2026-01-01T09:15:00.000Z");
    const presence = { ...PRESENCE, busyUntil: "2026-01-01T09:30:00.000Z" };
    expect(nextBoundary(now, presence).toISOString()).toBe("2026-01-01T09:30:00.000Z");
  });

  test("is the top of the next hour when it comes before the calendar event end", () => {
    const now = new Date("2026-01-01T09:15:00.000Z");
    const presence = { ...PRESENCE, busyUntil: "2026-01-01T11:00:00.000Z" };
    expect(nextBoundary(now, presence).toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });
});

describe("nextDigest", () => {
  test.each([
    ["2026-01-01T10:00:00.000Z", "2026-01-01T18:00:00.000Z"],
    ["2026-01-01T19:00:00.000Z", "2026-01-02T08:00:00.000Z"],
    ["2026-01-01T07:00:00.000Z", "2026-01-01T08:00:00.000Z"],
  ])("from %s picks the earlier of job end and 08:00", (now, expected) => {
    expect(nextDigest(new Date(now), { workHours: ["09:00", "18:00"] }).toISOString()).toBe(
      expected,
    );
  });
});

describe("due", () => {
  function row(state: LedgerRow["state"], releaseAt: string): LedgerRow {
    return {
      id: "claude-hook:1",
      key: "1",
      ts: releaseAt,
      source: "claude-hook",
      kind: "idle",
      title: "t",
      tier: "digest",
      releaseAt,
      state,
      reason: "test",
    };
  }

  test("includes open and held rows whose releaseAt has passed", () => {
    const now = new Date("2026-01-01T10:00:00.000Z");
    const rows = [
      row("open", "2026-01-01T09:00:00.000Z"),
      row("held", "2026-01-01T09:59:59.000Z"),
      row("open", "2026-01-01T10:00:01.000Z"),
      row("resolved", "2026-01-01T09:00:00.000Z"),
    ];
    expect(due(rows, now).map((r) => r.releaseAt)).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-01-01T09:59:59.000Z",
    ]);
  });
});
