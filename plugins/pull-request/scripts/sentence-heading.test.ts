import { expect, test } from "bun:test";
import { classifyPrHeading } from "./sentence-heading";

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
