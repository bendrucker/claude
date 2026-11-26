import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { directory } from "../../../../../packages/eval-corpus/storage";
import { sync } from "../../../../../packages/eval-corpus/sync";
import { corpusAt } from "./sync";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "session-sync-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("a push uploads the mined data and results but not the rebuilt index", async () => {
  const source = join(root, "source");
  const files = [
    "bench/replay.json",
    "bench/snap/a.jsonl",
    "bench/results/r.json",
    "bench/bench.ts",
    "session/data/cases.jsonl",
    "session/data/index.duckdb",
    "session/data/index.duckdb.wal",
    "session/results/run.json",
    "session/cases/tracked.yaml",
    "search/labels.jsonl",
    "search/score.ts",
  ];
  await Promise.all(files.map((file) => Bun.write(join(source, file), "x")));
  await sync(corpusAt(source), "push", directory(join(root, "bucket")));

  expect(
    (await readdir(join(root, "bucket"), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(root.length + "/bucket/".length))
      .toSorted(),
  ).toMatchInlineSnapshot(`
    [
      "session/bench/replay.json",
      "session/bench/results/r.json",
      "session/bench/snap/a.jsonl",
      "session/eval/data/cases.jsonl",
      "session/eval/results/run.json",
      "session/search/labels.jsonl",
    ]
  `);
});
