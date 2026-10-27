import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { check, GRADERS } from "../../scripts/check";

// A pre-commit hook runs these with GIT_DIR and GIT_INDEX_FILE set, which would point the
// fixture repos at this one.
for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) delete process.env[key];

const dir = join(import.meta.dirname, "test-adapters");

const failed = async (file: string) => {
  const verdicts = await check(join(dir, file), "pydantic");
  return GRADERS.filter((g) => verdicts[g]?.passed !== true);
};

describe("pydantic test adapters", () => {
  test("correct passes every grader", async () => {
    expect(await failed("correct.ts")).toEqual([]);
  }, 180_000);

  test.each(["tags", "traces", "rescore", "run"])(
    "broken-%s fails only %s",
    async (grader) => {
      expect(await failed(`broken-${grader}.ts`)).toEqual([grader]);
    },
    180_000,
  );

  // check.ts grades `rescore` and `run` through the adapter's own `read`, so a broken read fails all three.
  test("broken-read fails read, rescore, and run", async () => {
    expect(await failed("broken-read.ts")).toEqual(["read", "rescore", "run"]);
  }, 180_000);
});
