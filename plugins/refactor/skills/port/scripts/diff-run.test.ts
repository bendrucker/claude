import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./diff-run";
import { type Capture, firstDivergence } from "./fingerprint";
import { Ledger } from "./ledger";

const ok = (stdout: string) => ({ exit: 0, stdout, stderr: "" });

describe("firstDivergence", () => {
  test("matching runs have none", () => {
    expect(firstDivergence(ok("a\n"), ok("a\n"))).toBeUndefined();
  });

  test.each<{ name: string; old: Capture; new: Capture; fingerprint: string }>([
    {
      name: "exit code comes first",
      old: { exit: 2, stdout: "x", stderr: "" },
      new: { exit: 1, stdout: "y", stderr: "" },
      fingerprint: "exit:2→1",
    },
    {
      name: "number on a line",
      old: ok("Week 14\n"),
      new: ok("Week 13\n"),
      fingerprint: "stdout:number:Week 9",
    },
    {
      name: "same line shape, other numbers",
      old: ok("Week 52\n"),
      new: ok("Week 51\n"),
      fingerprint: "stdout:number:Week 9",
    },
    {
      name: "case change",
      old: ok("NAME | X\n"),
      new: ok("Name | X\n"),
      fingerprint: "stdout:case:AME→ame",
    },
    {
      name: "missing trailing newline",
      old: ok("a\n"),
      new: ok("a"),
      fingerprint: "stdout:trailing-whitespace",
    },
    {
      name: "reordered lines",
      old: ok("a\nb\n"),
      new: ok("b\na\n"),
      fingerprint: "stdout:line-order",
    },
    {
      name: "JSON path with indices masked",
      old: ok('{"items":[{"id":1,"n":2}]}'),
      new: ok('{"items":[{"id":1,"n":3}]}'),
      fingerprint: "stdout:json:$.items[].n:value",
    },
    {
      name: "missing line",
      old: ok("a\nTotal 3\n"),
      new: ok("a\n"),
      fingerprint: "stdout:missing-line:Total 9",
    },
    {
      name: "stderr after matching stdout",
      old: { exit: 1, stdout: "", stderr: "bad: x\n" },
      new: { exit: 1, stdout: "", stderr: "error: x\n" },
      fingerprint: "stderr:text:bad→error",
    },
  ])("$name", (row) => {
    expect(firstDivergence(row.old, row.new)?.fingerprint).toBe(row.fingerprint);
  });
});

describe("run", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "diff-run-"));
    const files: [string, string][] = [
      ["a.txt", "Hello"],
      ["b.txt", "hello"],
      ["c.txt", "HELLO"],
    ];
    await Promise.all(files.map(([name, body]) => Bun.write(join(dir, name), body)));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const opts = (extra = {}) => ({
    old: "cat {}",
    new: "tr A-Z a-z < {}",
    inputs: ["a.txt", "b.txt", "c.txt"].map((f) => join(dir, f)),
    out: join(dir, "out"),
    stdin: false,
    normalize: [],
    jobs: 2,
    timeout: 5000,
    ...extra,
  });

  test("counts matches and groups divergences", async () => {
    const result = await run(opts());
    expect(result).toMatchObject({ matched: 1, exempt: 0, total: 3 });
    expect(result.ledger.rows.map((r) => [r.fingerprint, r.count])).toEqual([
      ["stdout:case:H→h", 1],
      ["stdout:case:HELLO→hello", 1],
    ]);
  });

  test("keeps statuses across reruns and counts exempt rows as matches", async () => {
    await run(opts());
    const path = join(dir, "out", "ledger.json");
    const ledger = Ledger.parse(await Bun.file(path).json());
    const [first, ...rest] = ledger.rows;
    await Bun.write(
      path,
      JSON.stringify({ rows: [{ ...first, status: "exempt", note: "signed off" }, ...rest] }),
    );
    const again = await run(opts());
    expect(again.exempt).toBe(1);
    expect(again.ledger.rows[0]).toMatchObject({ status: "exempt", note: "signed off" });
  });

  test("marks a row fixed once its fingerprint stops appearing", async () => {
    await run(opts());
    const fixed = await run(opts({ new: "cat {}" }));
    expect(fixed.matched).toBe(3);
    expect(fixed.ledger.rows.every((r) => r.status === "fixed" && r.count === 0)).toBe(true);
  });

  test("feeds inputs on stdin", async () => {
    const result = await run(opts({ old: "cat", new: "cat", stdin: true }));
    expect(result.matched).toBe(3);
  });

  test("normalizes fields meaningless by contract", async () => {
    const result = await run(
      opts({ old: "echo id=$RANDOM", new: "echo id=$RANDOM", normalize: [String.raw`id=\d+`] }),
    );
    expect(result.matched).toBe(3);
  });

  test("writes the markdown ledger", async () => {
    await run(opts());
    expect(await Bun.file(join(dir, "out", "ledger.md")).text()).toContain("match 1/3 (33.3%)");
  });
});
