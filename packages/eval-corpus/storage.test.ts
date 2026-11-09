import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import type { Filter } from "./bucket";
import { directory, included, s3Args } from "./storage";

test.each<{ direction: "pull" | "push"; from: string; to: string }>([
  { direction: "pull", from: "s3://ben-drucker-agents-eval-corpus/suite/data", to: "/local" },
  { direction: "push", from: "/local", to: "s3://ben-drucker-agents-eval-corpus/suite/data" },
])("$direction syncs from $from to $to", ({ direction, from, to }) => {
  expect(
    s3Args(direction, "/local", "suite/data", [{ exclude: "*" }, { include: "a/*" }], {
      profile: "p",
      dryRun: true,
    }),
  ).toEqual([
    "s3",
    "sync",
    from,
    to,
    "--exclude",
    "*",
    "--include",
    "a/*",
    "--profile",
    "p",
    "--dryrun",
  ]);
});

test("a false profile leaves auth to the environment", () => {
  expect(s3Args("pull", "/l", "k", [], { profile: false })).toEqual([
    "s3",
    "sync",
    "s3://ben-drucker-agents-eval-corpus/k",
    "/l",
  ]);
});

test.each<{ path: string; filters: Filter[]; expected: boolean }>([
  { path: "a.json", filters: [], expected: true },
  { path: ".DS_Store", filters: [{ exclude: ".*" }], expected: false },
  { path: "sub/.hidden", filters: [{ exclude: ".*" }], expected: true },
  { path: ".claude/settings.json", filters: [{ exclude: ".*" }], expected: false },
  { path: ".claude/settings.json", filters: [], expected: true },
  { path: "snap/x/y.json", filters: [{ exclude: "*" }, { include: "snap/*" }], expected: true },
  {
    path: "index.duckdb",
    filters: [{ exclude: "*" }, { include: "*" }, { exclude: "*.duckdb*" }],
    expected: false,
  },
  {
    path: "scenario-1/case.yaml",
    filters: [{ exclude: "*" }, { include: "scenario-?/*" }],
    expected: true,
  },
  { path: "a+b.json", filters: [{ exclude: "a+b.json" }], expected: false },
])("$path under $filters is included: $expected", ({ path, filters, expected }) => {
  expect(included(path, filters)).toBe(expected);
});

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eval-corpus-storage-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("directory storage round-trips filtered files and drops file modes", async () => {
  const local = join(root, "local");
  const back = join(root, "back");
  const bucket = directory(join(root, "bucket"));
  await Bun.write(join(local, "keep", "run.sh"), "echo hi\n");
  await Bun.write(join(local, "drop.txt"), "no\n");
  await $`chmod 755 ${join(local, "keep", "run.sh")}`;

  const filters: Filter[] = [{ exclude: "*" }, { include: "keep/*" }];
  await bucket.copy("push", local, "suite", filters);
  await bucket.copy("pull", back, "suite", filters);

  expect(await readdir(join(root, "bucket", "suite"), { recursive: true })).toEqual([
    "keep",
    "keep/run.sh",
  ]);
  expect(await Bun.file(join(back, "keep", "run.sh")).text()).toBe("echo hi\n");
  expect((await Bun.file(join(back, "keep", "run.sh")).stat()).mode & 0o111).toBe(0);
});

test("pulling a key the bucket lacks copies nothing", async () => {
  await directory(join(root, "bucket")).copy("pull", join(root, "local"), "missing", []);
  expect(await Bun.file(join(root, "local")).exists()).toBe(false);
});
