import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { ensureIndex, getDb } from "../../skills/session/scripts/db";
import { z } from "zod";

const FIXTURES = join(import.meta.dirname, "..", "..", "skills", "session", "fixtures", "sessions");
const dir = mkdtempSync(join(tmpdir(), "session-bench-test-"));
const db = join(dir, "index", "session.duckdb");

const Rows = z.array(
  z.looseObject({ group: z.string(), arm: z.string(), n: z.number(), failures: z.number() }),
);
const query = { count: 1, sessions: 1, ooms: 0, last: "", covers: [] };

beforeAll(async () => {
  mkdirSync(join(dir, "index"), { recursive: true });
  const index = await getDb(join(dir, "index"));
  await ensureIndex(index, { projectsDir: FIXTURES, importsDir: join(dir, "imports") });
  index.close();
  await Bun.write(
    join(dir, "replay.json"),
    JSON.stringify([
      {
        ...query,
        id: "usage",
        sql: "SELECT model, sum(output_tokens) FROM message_usage GROUP BY 1",
      },
      { ...query, id: "index-health", name: "index-health", sql: "" },
    ]),
  );
});

afterAll(async () => {
  await $`rm -rf ${dir}`;
});

const bench = (...args: string[]) =>
  $`bun ${join(import.meta.dirname, "bench.ts")} ${args}`.quiet();

test("run replays each query at both limits and leaves the index unchanged", async () => {
  const before = await Bun.file(db).bytes();
  const out = join(dir, "run");
  await bench(
    "run",
    "--arm",
    `base=${db}`,
    "--arm",
    `aa=${db}`,
    "--replay",
    join(dir, "replay.json"),
    "--out",
    out,
    "--runs",
    "2",
    "--warmup",
    "0",
  );
  const rows = Rows.parse(await Bun.file(join(out, "queries.summary.json")).json());
  expect(rows.map((r) => `${r.group} ${r.arm} ${r.n}`)).toEqual([
    "usage mac base 2",
    "usage mac aa 2",
    "usage vm base 2",
    "usage vm aa 2",
    "index-health mac base 2",
    "index-health mac aa 2",
    "index-health vm base 2",
    "index-health vm aa 2",
  ]);
  expect(rows.every((r) => r.failures === 0 && typeof r.latency === "number")).toBe(true);
  expect(await Bun.file(join(out, "hyperfine", "usage.vm.json")).exists()).toBe(true);
  expect(await Bun.file(db).bytes()).toEqual(before);
});

test("refresh times a changed transcript against a clone", async () => {
  const before = await Bun.file(db).bytes();
  const out = join(dir, "refresh");
  await bench("refresh", "--arm", `base=${db}`, "--out", out, "--rows", "20", "--runs", "2");
  const [row] = Rows.parse(await Bun.file(join(out, "refresh.summary.json")).json());
  expect(row).toMatchObject({ group: "refresh-20x1", arm: "base", n: 2, failures: 0 });
  expect(await Bun.file(db).bytes()).toEqual(before);
});
