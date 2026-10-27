import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { check, GRADERS } from "../../scripts/check";

const dir = join(import.meta.dirname, "test-adapters");
// A replay runs the real promptfoo, which bunx may first have to download.
const TIMEOUT_MS = 180_000;

// A pre-commit run exports repository variables that would point check.ts's git calls at the outer repo.
for (const name of Object.keys(process.env)) if (name.startsWith("GIT_")) delete process.env[name];

async function failing(file: string): Promise<string[]> {
  const verdicts = await check(join(dir, file), "promptfoo");
  return GRADERS.filter((g) => verdicts[g]?.passed !== true);
}

describe("promptfoo test adapters", () => {
  test(
    "correct passes every grader",
    async () => {
      expect(await failing("correct.ts")).toEqual([]);
    },
    TIMEOUT_MS,
  );

  // `run` grades the result through `read`, so a `read` mistake fails both.
  const expected: Record<string, string[]> = {
    read: ["read", "run"],
    tags: ["tags"],
    traces: ["traces"],
    rescore: ["rescore"],
    run: ["run"],
  };
  test.each(Object.entries(expected))(
    "broken-%s fails %p",
    async (grader, failures) => {
      expect(await failing(`broken-${grader}.ts`)).toEqual(failures);
    },
    TIMEOUT_MS,
  );
});
