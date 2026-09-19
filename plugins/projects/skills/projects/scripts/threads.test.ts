import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fixture, NOW, row } from "./fixture";
import {
  appendOutcome,
  latestRows,
  ledgerPath,
  openThreads,
  parseTags,
  readLedger,
} from "./threads";

describe("parseTags", () => {
  test("reads repeated key=value pairs, last value winning", () => {
    expect(parseTags(["project=ledger", "by=chief", "by=lead-ledger"])).toEqual({
      project: "ledger",
      by: "lead-ledger",
    });
  });

  test("keeps an = inside the value", () => {
    expect(parseTags(["note=a=b"])).toEqual({ note: "a=b" });
  });

  test.each([["novalue"], ["=x"], ["Key=x"], ["k="]])("rejects %s", (value) => {
    expect(() => parseTags([value])).toThrow(/must be <key>=<value>/);
  });

  test("rejects a tag value too long to sit in a column", () => {
    expect(() => parseTags([`project=${"x".repeat(201)}`])).toThrow(/at most 200 characters/);
    expect(parseTags([`project=${"x".repeat(200)}`]).project).toHaveLength(200);
  });

  test("refuses more tags than a routing key set needs", () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `k${i}=v`);
    expect(parseTags(tags(8))).toHaveProperty("k7", "v");
    expect(() => parseTags(tags(9))).toThrow(/at most 8 tags, given 9/);
  });
});

describe("readLedger", () => {
  test("skips lines that are not rows and reports each one", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ledger-"));
    const good = row({});
    await Bun.write(
      ledgerPath(dataDir),
      `${JSON.stringify(good)}\nnot json\n{"ts":"x"}\n\n${JSON.stringify(good)}\n`,
    );
    const warnings: string[] = [];
    const rows = await readLedger(dataDir, (message) => warnings.push(message));
    expect(rows).toEqual([good, good]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/:2: not JSON/);
    expect(warnings[1]).toMatch(/:3: /);
  });

  test("is empty without a file", async () => {
    expect(await readLedger(mkdtempSync(join(tmpdir(), "ledger-")))).toEqual([]);
  });
});

describe("folding", () => {
  test("keeps the latest row per thread in first-seen order", async () => {
    const latest = latestRows(await readLedger(await fixture()));
    expect(latest.map((entry) => [entry.branch, entry.outcome])).toEqual([
      ["done-thing", "done"],
      ["fix-thing", "blocked"],
      ["one-off", "dispatched"],
      ["lost", "orphaned"],
    ]);
  });

  test("opens only dispatched and blocked threads, filtered by every tag", async () => {
    const rows = await readLedger(await fixture());
    expect(openThreads(rows).map((entry) => entry.branch)).toEqual(["fix-thing", "one-off"]);
    expect(openThreads(rows, { project: "ledger" }).map((entry) => entry.branch)).toEqual([
      "fix-thing",
    ]);
    expect(openThreads(rows, { by: "chief" }).map((entry) => entry.branch)).toEqual(["one-off"]);
    expect(openThreads(rows, { project: "ledger", by: "chief" })).toEqual([]);
  });
});

describe("appendOutcome", () => {
  test("copies the thread's identifiers onto the outcome row", async () => {
    const dataDir = await fixture();
    const written = await appendOutcome(
      { repo: "/repo", branch: "one-off", state: "done", pr: "https://example.test/pr/2" },
      dataDir,
      () => NOW,
    );
    expect(written).toEqual(
      row({
        ts: NOW.toISOString(),
        branch: "one-off",
        agent: "one-off",
        pane: "wA:p1",
        outcome: "done",
        pr: "https://example.test/pr/2",
        tags: { by: "chief" },
      }),
    );
    const rows = await readLedger(dataDir);
    expect(rows.at(-1)).toEqual(written);
    expect(openThreads(rows).map((entry) => entry.branch)).toEqual(["fix-thing"]);
  });

  test("drops the previous note and keeps the pr", async () => {
    const dataDir = await fixture();
    const done = await appendOutcome(
      { repo: "/repo", branch: "fix-thing", state: "done", pr: "https://example.test/pr/3" },
      dataDir,
    );
    expect(done.note).toBeUndefined();
    const blocked = await appendOutcome(
      { repo: "/repo", branch: "fix-thing", state: "blocked", note: "reopened" },
      dataDir,
    );
    expect(blocked).toMatchObject({ note: "reopened", pr: "https://example.test/pr/3" });
  });

  test("refuses a thread the ledger never saw", async () => {
    let message = "";
    try {
      await appendOutcome({ repo: "/repo", branch: "nope", state: "done" }, await fixture());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/no dispatch of nope in \/repo/);
  });

  test("refuses a note too long to keep a row's ceiling", async () => {
    const dataDir = await fixture();
    const outcome = (note: string) =>
      appendOutcome({ repo: "/repo", branch: "fix-thing", state: "blocked", note }, dataDir);
    let message = "";
    try {
      await outcome("w".repeat(501));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/at most 500 characters, given 501/);
    const blocked = await outcome("w".repeat(500));
    expect(blocked.note).toHaveLength(500);
    expect(JSON.stringify(blocked).length).toBeLessThan(1_500);
  });
});
