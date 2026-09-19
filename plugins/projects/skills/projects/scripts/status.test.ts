import { describe, expect, test } from "bun:test";
import { fixture, NOW, row } from "./fixture";
import { readProjects } from "./projects";
import { buildStatus, formatAge, formatStatus } from "./status";
import { type DispatchLedgerRow, readLedger } from "./threads";

describe("status", () => {
  test("renders the routing block and the open threads", async () => {
    const dataDir = await fixture();
    const status = buildStatus(
      await readProjects(dataDir),
      await readLedger(dataDir),
      {},
      new Set(["lead-ledger", "one-off"]),
    );
    expect(status.projects).toMatchObject([{ slug: "ledger", lead: "live", open: 1 }]);
    expect(formatStatus(status, NOW)).toMatchSnapshot();
  });

  test("marks the lead unknown when herdr cannot answer, and the blocks empty when they are", () => {
    const none: DispatchLedgerRow[] = [];
    const status = buildStatus([{ slug: "p", name: "P", description: "d" }], none, {}, null);
    expect(status.projects[0]?.lead).toBe("unknown");
    expect(formatStatus(status, NOW)).toMatchSnapshot();
    expect(formatStatus(buildStatus([], none, {}, null), NOW)).toBe(
      "projects\nno projects\n\nthreads\nno open threads\n",
    );
  });

  test("keeps every item on one line when a field carries newlines", () => {
    const status = buildStatus(
      [{ slug: "p", name: "P", description: "first line\nsecond  line\n" }],
      [row({ pr: "https://example.com/pr/1\nstray" })],
      {},
      null,
    );
    const lines = formatStatus(status, NOW).trimEnd().split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("first line second line");
    expect(lines[5]).toContain("https://example.com/pr/1 stray");
  });
});

describe("formatAge", () => {
  test.each([
    ["2026-09-18T11:59:30.000Z", "0m"],
    ["2026-09-18T11:15:00.000Z", "45m"],
    ["2026-09-18T09:00:00.000Z", "3h"],
    ["2026-09-16T13:00:00.000Z", "47h"],
    ["2026-09-16T11:00:00.000Z", "2d"],
    ["2026-09-18T13:00:00.000Z", "0m"],
    ["yesterday", "?"],
  ])("%s reads as %s", (ts, expected) => {
    expect(formatAge(ts, NOW)).toBe(expected);
  });
});
