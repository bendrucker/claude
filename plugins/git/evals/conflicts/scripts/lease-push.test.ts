import { expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";

const grader = join(import.meta.dirname, "..", "graders", "lease-push.md");
const [, frontmatter = ""] = (await Bun.file(grader).text()).split(/^---$/m);
const { pattern } = z.object({ pattern: z.string() }).parse(Bun.YAML.parse(frontmatter));
const forces = new RegExp(pattern);

// The grader reads the raw trace, where a command sits inside a JSON string.
const flagged = (command: string) => forces.test(JSON.stringify({ input: { command } }));

test.each([
  "git push --force origin HEAD",
  "git push -f",
  "git push origin +HEAD:feature",
  "git push -uf origin x",
  "git push origin HEAD --force",
  "git add -A && git push --force-with-lease && git push --force",
])("flags %s", (command) => {
  expect(flagged(command)).toBe(true);
});

test.each([
  "git push --force-with-lease",
  "git push --force-with-lease --force-if-includes origin HEAD",
  "git push",
  "git push -u origin feature",
  "git push origin feature-fix",
  "git add -f ignored.txt && git push",
  "git push 2>&1 | tail -f log",
])("passes %s", (command) => {
  expect(flagged(command)).toBe(false);
});
