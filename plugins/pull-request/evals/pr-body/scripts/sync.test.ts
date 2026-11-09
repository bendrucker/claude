import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { $ } from "bun";
import { directory } from "../../../../../packages/eval-corpus/storage";
import { sync, syncCommand } from "../../../../../packages/eval-corpus/sync";
import { corpusAt } from "./sync";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pr-body-sync-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("a pull restores the mined files, skips tracked cases, and makes fixture scripts executable", async () => {
  const source = join(root, "source");
  const files = [
    "pr-body/fixtures/labels.json",
    "pr-body/data/revisions/r1.json",
    "pr-body/data/revisions/.DS_Store",
    "create-scenarios/scenario-1/case.yaml",
    "create-scenarios/scenario-1/fixture.sh",
    "create-scenarios/examples/scenario-1/shipped.md",
    "create-scenarios/work-2/case.yaml",
    "create-scenarios/tracked/case.yaml",
  ];
  await Promise.all(files.map((file) => Bun.write(join(source, file), "x")));
  const bucket = directory(join(root, "bucket"));
  await sync(corpusAt(source), "push", bucket);

  const dest = join(root, "dest");
  await syncCommand(corpusAt(dest), () => bucket).parseAsync(["pull"], { from: "user" });

  const pulled = await readdir(dest, { recursive: true, withFileTypes: true });
  expect(
    pulled
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(dest.length + 1))
      .toSorted(),
  ).toMatchInlineSnapshot(`
    [
      "create-scenarios/examples/scenario-1/shipped.md",
      "create-scenarios/scenario-1/case.yaml",
      "create-scenarios/scenario-1/fixture.sh",
      "create-scenarios/work-2/case.yaml",
      "pr-body/data/revisions/r1.json",
      "pr-body/fixtures/labels.json",
    ]
  `);
  await $`test -x ${join(dest, "create-scenarios/scenario-1/fixture.sh")}`;
});
