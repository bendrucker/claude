import { expect, it, test } from "bun:test";
import { SKILL_GLOBS, skillName } from "./assets";
import { type SkillFile, skillFiles, skillGrants, violations } from "./check-skill-invocability";

test.each<string>([...SKILL_GLOBS])("discovers skills matching %s", async (pattern) => {
  const root = pattern.split("/")[0];
  const paths = (await skillFiles()).map((file) => file.path);

  expect(paths.filter((path) => path.startsWith(`${root}/`))).not.toBeEmpty();
});

test.each<{ name: string; path: string; frontmatterName?: string; expected: string }>([
  {
    name: "plugin skill namespaces on its plugin",
    path: "plugins/comments/skills/audit/SKILL.md",
    expected: "comments:audit",
  },
  {
    name: "entry skill collapses to the plugin name",
    path: "plugins/writing/skills/writing/SKILL.md",
    expected: "writing",
  },
  {
    name: "frontmatter name wins over derivation",
    path: "plugins/review/skills/code/SKILL.md",
    frontmatterName: "review:code",
    expected: "review:code",
  },
  { name: "user skill carries no namespace", path: "user/skills/ship/SKILL.md", expected: "ship" },
  {
    name: "project skill carries no namespace",
    path: ".claude/skills/coverage/SKILL.md",
    expected: "coverage",
  },
])("$name", ({ path, frontmatterName, expected }) => {
  expect(skillName(path, frontmatterName)).toBe(expected);
});

test.each<{ name: string; allowedTools: string[]; expected: string[] }>([
  { name: "bare grant", allowedTools: ["Skill(comments:audit)"], expected: ["comments:audit"] },
  {
    name: "surrounding whitespace",
    allowedTools: [" Skill(review:code) "],
    expected: ["review:code"],
  },
  {
    name: "grant with arguments",
    allowedTools: ["Skill(mac:jxa-run Things3:*)"],
    expected: ["mac:jxa-run"],
  },
  {
    name: "non-Skill entries",
    allowedTools: ["Bash(git diff:*)", "Agent", "AskUserQuestion"],
    expected: [],
  },
  { name: "empty parens", allowedTools: ["Skill()"], expected: [] },
])("$name", ({ allowedTools, expected }) => {
  expect(skillGrants(allowedTools)).toEqual(expected);
});

it("reports only grants whose target cannot be reached", () => {
  const skill = (overrides: Partial<SkillFile>): SkillFile => ({
    path: "user/skills/caller/SKILL.md",
    name: "caller",
    disabled: false,
    grants: [],
    ...overrides,
  });

  const files: SkillFile[] = [
    skill({
      path: "plugins/comments/skills/audit/SKILL.md",
      name: "comments:audit",
      disabled: true,
    }),
    skill({ path: "plugins/review/skills/code/SKILL.md", name: "review:code" }),
    skill({
      path: "user/skills/ship/SKILL.md",
      name: "ship",
      grants: ["comments:audit", "verify", "review:code", "third-party:thing"],
    }),
  ];

  expect(violations(files)).toMatchInlineSnapshot(`
    [
      "user/skills/ship/SKILL.md: Skill(comments:audit) (disable-model-invocation in plugins/comments/skills/audit/SKILL.md)",
      "user/skills/ship/SKILL.md: Skill(verify) (user-invocable-only built-in)",
    ]
  `);
});
