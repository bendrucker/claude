import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSuites } from "./suite";

test("findSuites lists every directory holding a case, marking local-only ones", async () => {
  const root = mkdtempSync(join(tmpdir(), "suites-"));
  await Promise.all(
    [
      "plugins/p/evals/a/one/case.yaml",
      "plugins/p/evals/a/two/case.yaml",
      "plugins/p/evals/corpus/one/case.yaml",
      "plugins/p/evals/corpus/.local-only",
      "plugins/p/evals/scripts/score.ts",
      "evals/user/tdd/one/case.yaml",
    ].map((p) => Bun.write(join(root, p), "")),
  );
  expect(findSuites(root)).toEqual([
    { dir: "evals/user/tdd", localOnly: false },
    { dir: "plugins/p/evals/a", localOnly: false },
    { dir: "plugins/p/evals/corpus", localOnly: true },
  ]);
});
