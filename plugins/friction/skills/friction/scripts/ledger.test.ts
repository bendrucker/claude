import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FindingInput,
  decide,
  fingerprint,
  readLedger,
  record,
  recordOutcome,
  reduce,
} from "./ledger";

function ledger(): string {
  return join(mkdtempSync(join(tmpdir(), "friction-")), "ledger.jsonl");
}

const AT = "2026-10-20T13:00:00Z";

// The Studio reference set, Oct 18 to 20. A correct daily run on Oct 20 opens one
// PR (unattributed load), lists the DuckDB and refresh symptoms below the cut,
// keeps background CPU in the ledger, and stays silent about memory.
const unattributed: FindingInput = {
  type: "contention",
  target: "unattributed load",
  impact: "moderate",
  metric: "load1 minus tracked cores during load>30 minutes",
  fix: "osquery.conf: 10 s per-name process and thread snapshot",
  small: true,
};
const duckdb: FindingInput = {
  type: "contention",
  target: "bun, duckdb",
  impact: "high",
  metric: "60% of load>30 minutes have a bun/duckdb job within 2 min, vs 4% baseline",
  fix: "rebuild session-index views per touched session",
  small: false,
};
const refresh: FindingInput = {
  type: "slow-command",
  target: "session-index refresh",
  impact: "moderate",
  metric: "6.6 to 28 GB written per refresh",
  fix: "rebuild session-index views per touched session",
  small: false,
};
const background: FindingInput = {
  type: "contention",
  target: "herdr server",
  impact: "low",
  metric: "0.054 cores continuous",
  fix: "none at this size",
  small: true,
};

describe("reference set", () => {
  test("daily run on the third day", async () => {
    const path = ledger();
    await record(path, [unattributed, duckdb, background], "1d", "2026-10-18", AT);
    await record(path, [unattributed, duckdb, refresh, background], "1d", "2026-10-19", AT);
    const decision = await record(
      path,
      [unattributed, duckdb, refresh, background],
      "1d",
      "2026-10-20",
      AT,
    );

    expect(decision.promote.map((e) => e.latest.target)).toEqual(["unattributed load"]);
    expect(decision.belowCut.map((e) => e.latest.target)).toEqual([
      "bun, duckdb",
      "session-index refresh",
    ]);
    expect(decision.ledgerOnly).toBe(1);
  });

  test("nothing promotes before the third day", async () => {
    const path = ledger();
    await record(path, [unattributed], "1d", "2026-10-18", AT);
    expect((await record(path, [unattributed], "1d", "2026-10-19", AT)).promote).toEqual([]);
  });

  test("a quiet day surfaces nothing", async () => {
    const decision = await record(ledger(), [], "1d", "2026-10-20", AT);
    expect(decision.promote).toEqual([]);
    expect(decision.belowCut).toEqual([]);
  });
});

describe("outcomes", () => {
  async function seenThreeDays(path: string): Promise<string> {
    // Sequential: each day's record reads the ledger the previous one wrote.
    await record(path, [unattributed], "1d", "2026-10-18", AT);
    await record(path, [unattributed], "1d", "2026-10-19", AT);
    await record(path, [unattributed], "1d", "2026-10-20", AT);
    return fingerprint(unattributed.type, unattributed.target);
  }

  test("a filed fingerprint is not filed again", async () => {
    const path = ledger();
    const fp = await seenThreeDays(path);
    await recordOutcome(path, fp, "filed", "2026-10-20", AT);
    expect((await record(path, [unattributed], "1d", "2026-10-21", AT)).promote).toEqual([]);
  });

  test("a dismissed fingerprint stays quiet for 30 days", async () => {
    const path = ledger();
    const fp = await seenThreeDays(path);
    await recordOutcome(path, fp, "dismissed", "2026-10-20", AT);
    expect(reduce(await readLedger(path), "2026-11-18").get(fp)?.status).toBe("suppressed");
    expect(reduce(await readLedger(path), "2026-11-20").get(fp)?.status).toBe("open");
  });

  test("a resolved fingerprint counts only sightings after the fix", async () => {
    const path = ledger();
    const fp = await seenThreeDays(path);
    await recordOutcome(path, fp, "resolved", "2026-10-20", AT);
    expect(reduce(await readLedger(path), "2026-10-20").get(fp)?.status).toBe("resolved");

    await record(path, [unattributed], "1d", "2026-10-21", AT);
    const entry = reduce(await readLedger(path), "2026-10-21").get(fp);
    expect(entry?.daysSeen).toBe(1);
    expect(entry?.regression).toBe(true);
  });
});

describe("weekly", () => {
  test("ranks open entries by persistence, then impact", async () => {
    const path = ledger();
    await record(path, [refresh], "1d", "2026-10-14", AT);
    await record(path, [refresh, duckdb], "1d", "2026-10-15", AT);
    const decision = await record(path, [refresh, duckdb, background], "7d", "2026-10-19", AT);
    expect(decision.promote.map((e) => e.latest.target)).toEqual([
      "session-index refresh",
      "bun, duckdb",
    ]);
  });

  test("ignores entries last seen before the window", async () => {
    const path = ledger();
    await record(path, [refresh], "1d", "2026-10-01", AT);
    expect(
      decide(reduce(await readLedger(path), "2026-10-19"), "7d", "2026-10-19").promote,
    ).toEqual([]);
  });
});

test("fingerprint ignores case and spacing in the target", () => {
  expect(fingerprint("contention", "Herdr  Server ")).toBe(
    fingerprint("contention", "herdr server"),
  );
});
