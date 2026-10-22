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

// Ben's calibration labels, Oct 21. Only the blocker was labeled same-day: a
// small daily fix that costs a retry turn was labeled weekly, and so was every
// persistent symptom whose fix is not small.
const cloudsmith: FindingInput = {
  type: "failing-command",
  target: "cloudsmith auth",
  impact: "high",
  metric: "9 of 11 runs failed across 25 minutes of retries",
  fix: "save the working auth invocation",
  small: true,
};
const validateBody: FindingInput = {
  type: "tool-gap",
  target: "validate-body hook",
  impact: "moderate",
  metric: "1 rejection a day, each costing a retry turn",
  fix: "skip a body file the same command creates",
  small: true,
};
const duckdb: FindingInput = {
  type: "contention",
  target: "bun, duckdb",
  impact: "high",
  metric: "67% of load>30 minutes have a bun/duckdb job within 2 min, vs 7% baseline",
  fix: "make the scheduled session-index job incremental",
  small: false,
};
const refresh: FindingInput = {
  type: "contention",
  target: "session-index refresh",
  impact: "moderate",
  metric: "36 to 72 GB written a day",
  fix: "rebuild session-index views per changed session",
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

describe("calibration labels", () => {
  test("the daily run changes only the blocker", async () => {
    const path = ledger();
    await record(path, [validateBody, duckdb, refresh, background], "1d", "2026-10-18", AT);
    await record(path, [validateBody, duckdb, refresh, background], "1d", "2026-10-19", AT);
    const decision = await record(
      path,
      [cloudsmith, validateBody, duckdb, refresh, background],
      "1d",
      "2026-10-20",
      AT,
    );

    expect(decision.promote.map((e) => e.latest.target)).toEqual(["cloudsmith auth"]);
    expect(decision.belowCut.map((e) => e.latest.target)).toEqual([
      "bun, duckdb",
      "validate-body hook",
      "session-index refresh",
    ]);
    expect(decision.ledgerOnly).toBe(1);
  });

  test("a persistent moderate symptom never promotes mid-week", async () => {
    const path = ledger();
    await record(path, [validateBody], "1d", "2026-10-18", AT);
    await record(path, [validateBody], "1d", "2026-10-19", AT);
    expect((await record(path, [validateBody], "1d", "2026-10-20", AT)).promote).toEqual([]);
  });

  test("a blocker not seen today does not promote", async () => {
    const path = ledger();
    await record(path, [cloudsmith], "1d", "2026-10-19", AT);
    expect((await record(path, [], "1d", "2026-10-20", AT)).promote).toEqual([]);
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
    await record(path, [cloudsmith], "1d", "2026-10-18", AT);
    await record(path, [cloudsmith], "1d", "2026-10-19", AT);
    await record(path, [cloudsmith], "1d", "2026-10-20", AT);
    return fingerprint(cloudsmith.type, cloudsmith.target);
  }

  test("a filed fingerprint is not filed again", async () => {
    const path = ledger();
    const fp = await seenThreeDays(path);
    await recordOutcome(path, fp, "filed", "2026-10-20", AT);
    expect((await record(path, [cloudsmith], "1d", "2026-10-21", AT)).promote).toEqual([]);
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

    await record(path, [cloudsmith], "1d", "2026-10-21", AT);
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
