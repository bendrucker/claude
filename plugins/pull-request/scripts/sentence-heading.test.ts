import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { classifyPrHeading } from "./sentence-heading";

const root = join(import.meta.dirname, "..", "..", "..");

// These files are byte-for-byte copies of the writing plugin's. The duplication
// is deliberate: plugins are distributed and installed one at a time, so runtime
// code can only import published npm packages, which rules out both a
// cross-plugin import and a `workspace:*` package. Read as text rather than
// imported, so the plugin-boundary checker still passes.
const copies: [string, string][] = [
  ["linguistics/heading.ts", "scripts/linguistics/heading.ts"],
  ["linguistics/preprocess.ts", "scripts/linguistics/preprocess.ts"],
  ["linguistics/tags.ts", "scripts/linguistics/tags.ts"],
  ["hooks/heading-case.ts", "scripts/heading-case.ts"],
];

test.each(copies)("writing/%s and pull-request/%s stay identical", async (source, destination) => {
  const [writing, pullRequest] = await Promise.all([
    Bun.file(join(root, "plugins", "writing", source)).text(),
    Bun.file(join(root, "plugins", "pull-request", destination)).text(),
  ]);
  expect(pullRequest).toBe(writing);
});

// The check above only runs when CI selects this plugin, and a writing-side edit
// selects it through the paths declared in `.ci.json`.
test("every copy source is under a declared CI path", async () => {
  const ci = z
    .object({ paths: z.array(z.string()) })
    .parse(await Bun.file(join(root, "plugins", "pull-request", ".ci.json")).json());
  const uncovered = copies
    .map(([source]) => `plugins/writing/${source}`)
    .filter((file) => !ci.paths.some((path) => file.startsWith(path)));
  expect(uncovered).toBeEmpty();
});

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
