import { describe, expect, test } from "bun:test";
import { githubBlobUrl, repoPathToRoute } from "./routes";

describe("repoPathToRoute", () => {
  test.each<{ name: string; path: string; expected: string }>([
    { name: "plugin README", path: "plugins/git/README.md", expected: "/plugins/git/" },
    { name: "plugin dir", path: "plugins/git", expected: "/plugins/git/" },
    { name: "plugin dir with slash", path: "plugins/git/", expected: "/plugins/git/" },
    {
      name: "hyphenated name",
      path: "plugins/pull-request/README.md",
      expected: "/plugins/pull-request/",
    },
  ])("routes $name", ({ path, expected }) => {
    expect(repoPathToRoute(path)).toBe(expected);
  });

  // Everything below has no page. Callers fall back to githubBlobUrl, which is
  // how a README's relative links to skills, references, and siblings resolve.
  test.each<{ name: string; path: string }>([
    { name: "skill", path: "plugins/git/skills/conflicts/SKILL.md" },
    { name: "agent", path: "plugins/writing/agents/style.md" },
    { name: "command", path: "plugins/plan/commands/review.md" },
    { name: "skill reference", path: "plugins/writing/skills/scan/references/tropes.md" },
    { name: "sibling next to a skill", path: "plugins/issue/skills/refine/bug.md" },
    { name: "plugin-level reference", path: "plugins/plan/references/guidelines.md" },
    { name: "hooks file", path: "plugins/git/hooks/hooks.json" },
    { name: "manifest", path: "plugins/git/.claude-plugin/plugin.json" },
    { name: "script", path: "plugins/git/scripts/branch.ts" },
    { name: "nested README", path: "plugins/claude-code/skills/session/README.md" },
    { name: "path outside plugins/", path: "packages/marketplace/index.ts" },
    { name: "repo root README", path: "README.md" },
  ])("gives $name no page", ({ path }) => {
    expect(repoPathToRoute(path)).toBeUndefined();
  });
});

test("githubBlobUrl points at the repo's main branch", () => {
  expect(githubBlobUrl("plugins/git/skills/conflicts/SKILL.md")).toBe(
    "https://github.com/bendrucker/claude/blob/main/plugins/git/skills/conflicts/SKILL.md",
  );
});
