import { expect, test } from "bun:test";
import { join } from "node:path";
import { classifyPrHeading } from "./sentence-heading";

const root = join(import.meta.dirname, "..", "..", "..");

// The files under `linguistics/` are byte-for-byte copies of the writing
// plugin's. The duplication is deliberate: plugins are distributed and installed
// one at a time, so runtime code can only import published npm packages, which
// rules out both a cross-plugin import and a `workspace:*` package. Read as text
// rather than imported, so the plugin-boundary checker still passes.
test.each(["heading.ts", "preprocess.ts", "tags.ts"])(
  "linguistics/%s stays identical to the writing plugin's copy",
  async (file) => {
    const [writing, pullRequest] = await Promise.all([
      Bun.file(join(root, "plugins", "writing", "linguistics", file)).text(),
      Bun.file(join(root, "plugins", "pull-request", "scripts", "linguistics", file)).text(),
    ]);
    expect(pullRequest).toBe(writing);
  },
);

test.each<[string, string, boolean]>([
  ["flags an interrogative opener", "Why This Happens", true],
  ["flags a linking verb", "The Cache Is Cold on Boot", true],
  ["flags a predicate verb", "The Hook Blocks the Push", true],
  ["flags a trailing question mark", "Does the Cache Warm?", true],
  ["flags a long heading", "How the Resolver Reads the Cache Before It Reaches the Database", true],
  ["passes a one-word label", "Changes", false],
  ["passes a noun phrase", "Known Follow-Up", false],
  ["passes a code-led label", "`validate.ts` Rewrite", false],
  ["passes a label with a short parenthetical", "Cache Warming (Historical)", false],
])("%s", (_name, heading, flagged) => {
  expect(classifyPrHeading(heading).flagged).toBe(flagged);
});
