import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { select, suites } from "./select";

let repo: string;

const files: Record<string, string> = {
  "plugins/p/evals/a/one/case.yaml": "plugins: [../../..]\n",
  "plugins/p/evals/b/one/case.yaml": "plugins: [../../.., ../../../../q]\n",
  "plugins/p/evals/local/one/case.yaml": "plugins: [../../..]\n",
  "plugins/p/evals/local/.local-only": "",
  "plugins/p/evals/notes/README.md": "no cases",
  "plugins/q/skills/s/SKILL.md": "",
  "evals/user/tdd/suite.yaml":
    "wrap:\n  skills: [user/skills/tdd]\n  context: [user/rules/ts.md]\n",
  "evals/user/tdd/one/case.yaml": "plugins: [../.., ../../../../plugins/q]\n",
  "user/skills/tdd/SKILL.md": "See [shared](../shared/ref.md) and [docs](https://x.dev).\n",
};

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), "select-repo-"));
  await Promise.all(Object.entries(files).map(([p, body]) => Bun.write(join(repo, p), body)));
});

test("finds suites with cases and skips local-only ones", async () => {
  expect(await suites(repo)).toEqual(["evals/user/tdd", "plugins/p/evals/a", "plugins/p/evals/b"]);
});

test.each<{ name: string; changed: string[]; expected: string[] }>([
  {
    name: "a plugin change runs its suites",
    changed: ["plugins/p/skills/x/SKILL.md"],
    expected: ["plugins/p/evals/a", "plugins/p/evals/b"],
  },
  {
    name: "a plugin the cases load runs the suite",
    changed: ["plugins/q/skills/s/SKILL.md"],
    expected: ["evals/user/tdd", "plugins/p/evals/b"],
  },
  {
    name: "a file a wrapped skill links to",
    changed: ["user/skills/shared/ref.md"],
    expected: ["evals/user/tdd"],
  },
  { name: "a wrapped skill", changed: ["user/skills/tdd/SKILL.md"], expected: ["evals/user/tdd"] },
  { name: "a wrapped rule", changed: ["user/rules/ts.md"], expected: ["evals/user/tdd"] },
  {
    name: "the suite itself",
    changed: ["evals/user/tdd/one/prompt.md"],
    expected: ["evals/user/tdd"],
  },
  { name: "a name prefix", changed: ["user/skills/tdd-extra/SKILL.md"], expected: [] },
  { name: "unrelated paths", changed: ["README.md", "user/rules/go.md"], expected: [] },
])("$name", async ({ changed, expected }) => {
  expect(await select(repo, changed)).toEqual(expected);
});
