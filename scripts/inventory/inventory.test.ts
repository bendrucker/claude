import { expect, test } from "bun:test";
import {
  AGENT_GLOBS,
  assetPaths,
  isScope,
  namespaced,
  origin,
  RULE_GLOBS,
  SKILL_GLOBS,
  scopeOf,
} from "../assets";
import { collect, filter, hookEntries, type Inventory } from "./collect";
import { isKind, KINDS, type Kind, render, section } from "./report";

const fixture: Inventory = {
  plugins: [
    {
      name: "git",
      description: "Git workflow",
      enabled: true,
      listed: true,
      local: true,
      skills: 1,
      agents: 0,
      commands: 0,
      hooks: 2,
      mcpServers: 0,
    },
    {
      name: "agents-md",
      description: "Loads AGENTS.md files",
      enabled: true,
      listed: true,
      local: false,
      skills: 0,
      agents: 0,
      commands: 0,
      hooks: 0,
      mcpServers: 0,
    },
  ],
  skills: [
    {
      name: "git:conflicts",
      scope: "plugin",
      plugin: "git",
      path: "plugins/git/skills/conflicts/SKILL.md",
      description: "Resolving git merge conflicts during rebase, merge, or cherry-pick.",
      modelInvocable: true,
      userInvocable: true,
    },
    {
      name: "afk",
      scope: "user",
      path: "user/skills/afk/SKILL.md",
      description: "Signal that you are stepping away.",
      modelInvocable: false,
      userInvocable: true,
    },
  ],
  agents: [
    {
      name: "review",
      scope: "user",
      path: "user/agents/review.md",
      description: "Review a pushed pull request.",
      model: "",
      tools: "all except Edit, Write",
    },
  ],
  commands: [],
  hooks: [
    {
      path: "plugins/git/hooks/hooks.json",
      scope: "plugin",
      plugin: "git",
      event: "PreToolUse",
      matcher: "Bash(git commit:*)",
      condition: "",
      command: "bun plugins/git/scripts/block-commit.ts",
    },
  ],
  rules: [
    { name: "go", scope: "user", path: "user/rules/go.md", paths: ["**/*.go"] },
    { name: "always", scope: "project", path: ".claude/rules/always.md", paths: [] },
  ],
  mcpServers: [{ name: "terraform", plugin: "terraform", path: "plugins/terraform/.mcp.json" }],
};

test.each<Kind>([...KINDS])("renders the %s table", (kind) => {
  expect(render(section(fixture, kind, 40))).toMatchSnapshot();
});

test.each<{ name: string; kind: Kind; expected: boolean }>([
  { name: "known kind", kind: "skills", expected: true },
  { name: "unknown kind", kind: "wordlists" as Kind, expected: false },
])("isKind: $name", ({ kind, expected }) => {
  expect(isKind(kind)).toBe(expected);
});

test("truncate 0 leaves descriptions intact", () => {
  const [row] = section(fixture, "skills", 0).rows;

  expect(row?.at(-1)).toBe("Resolving git merge conflicts during rebase, merge, or cherry-pick.");
});

test.each<{ name: string; path: string; expected: ReturnType<typeof origin> }>([
  {
    name: "plugin asset carries its plugin",
    path: "plugins/git/skills/conflicts/SKILL.md",
    expected: { scope: "plugin", path: "plugins/git/skills/conflicts/SKILL.md", plugin: "git" },
  },
  {
    name: "user asset has no plugin",
    path: "user/skills/afk/SKILL.md",
    expected: { scope: "user", path: "user/skills/afk/SKILL.md" },
  },
  {
    name: "anything else is project scope",
    path: ".claude/rules/hooks.md",
    expected: { scope: "project", path: ".claude/rules/hooks.md" },
  },
])("origin: $name", ({ path, expected }) => {
  expect(origin(path)).toEqual(expected);
});

test("hookEntries flattens every command and defaults a missing matcher", () => {
  const entries = [
    ...hookEntries("user/settings.json", {
      PostToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            { type: "command", command: "a" },
            { type: "command", command: "b" },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "c" }] }],
    }),
  ];

  expect(entries).toMatchInlineSnapshot(`
    [
      {
        "command": "a",
        "condition": "",
        "event": "PostToolUse",
        "matcher": "Write|Edit",
        "path": "user/settings.json",
        "scope": "user",
      },
      {
        "command": "b",
        "condition": "",
        "event": "PostToolUse",
        "matcher": "Write|Edit",
        "path": "user/settings.json",
        "scope": "user",
      },
      {
        "command": "c",
        "condition": "",
        "event": "Stop",
        "matcher": "*",
        "path": "user/settings.json",
        "scope": "user",
      },
    ]
  `);
});

test("hookEntries survives a manifest that declares an event with no commands", () => {
  const entries = [
    ...hookEntries("user/settings.json", {
      Stop: [{ matcher: "*" }],
      PostToolUse: [{ hooks: [{ type: "command", command: "a", if: "Bash(gh *)" }] }],
    }),
  ];

  expect(entries.map((entry) => [entry.event, entry.condition])).toEqual([
    ["PostToolUse", "Bash(gh *)"],
  ]);
});

test.each<{ name: string; path: string; frontmatterName: string; expected: string }>([
  {
    name: "plugin agent",
    path: "plugins/github/agents/logs.md",
    frontmatterName: "logs",
    expected: "github:logs",
  },
  {
    name: "user agent",
    path: "user/agents/review.md",
    frontmatterName: "review",
    expected: "review",
  },
  {
    name: "frontmatter that already namespaces",
    path: "plugins/github/agents/logs.md",
    frontmatterName: "github:logs",
    expected: "github:logs",
  },
])("namespaced: $name", ({ path, frontmatterName, expected }) => {
  expect(namespaced(path, frontmatterName)).toBe(expected);
});

test("plugin agents keep the namespace they are dispatched by", async () => {
  const { agents } = await collect();
  const logs = agents.filter((agent) => agent.path.endsWith("/agents/logs.md"));

  expect(logs.map((agent) => agent.name).toSorted()).toEqual(["github:logs", "gitlab:logs"]);
});

test("filter narrows every kind to one plugin", () => {
  const scoped = filter(fixture, { plugin: "git" });

  expect({
    plugins: scoped.plugins.map((p) => p.name),
    skills: scoped.skills.map((s) => s.name),
    agents: scoped.agents.length,
    hooks: scoped.hooks.length,
    mcpServers: scoped.mcpServers.length,
  }).toMatchInlineSnapshot(`
    {
      "agents": 0,
      "hooks": 1,
      "mcpServers": 0,
      "plugins": [
        "git",
      ],
      "skills": [
        "git:conflicts",
      ],
    }
  `);
});

test("filter narrows every kind to one scope", () => {
  const scoped = filter(fixture, { scope: "user" });

  expect(scoped.skills.map((s) => s.name)).toEqual(["afk"]);
  expect(scoped.plugins).toBeEmpty();
  expect(scoped.hooks).toBeEmpty();
});

test.each<{ name: string; globs: string[] }>([
  { name: "skills", globs: SKILL_GLOBS },
  { name: "agents", globs: AGENT_GLOBS },
  { name: "rules", globs: RULE_GLOBS },
])("assetPaths discovers $name", async ({ globs }) => {
  expect(await Array.fromAsync(assetPaths(globs))).not.toBeEmpty();
});

// Project-scope globs live under `.claude/`, which a glob only descends with `dot`.
test("assetPaths reaches every scope", async () => {
  const found = await Array.fromAsync(assetPaths(SKILL_GLOBS));

  expect(new Set(found.map(scopeOf))).toEqual(new Set(["plugin", "user", "project"]));
});

test("a glob whose directory is absent contributes nothing", async () => {
  expect(await Array.fromAsync(assetPaths(["nowhere/*.md"]))).toBeEmpty();
});

test("assetPaths skips test and fixture copies", async () => {
  // A recursive pattern reaches the SKILL.md files that skill-lint and the
  // session index keep as test data.
  const found = await Array.fromAsync(assetPaths(["plugins/**/SKILL.md"]));

  expect(found).not.toBeEmpty();
  expect(
    found.filter((path) => path.includes("/fixtures/") || path.includes("/test/")),
  ).toBeEmpty();
});

test.each<{ name: string; value: string; expected: boolean }>([
  { name: "known scope", value: "project", expected: true },
  { name: "unknown scope", value: "marketplace", expected: false },
])("isScope: $name", ({ value, expected }) => {
  expect(isScope(value)).toBe(expected);
});

test("scopeOf treats an unprefixed path as project scope", () => {
  expect(scopeOf("CLAUDE.md")).toBe("project");
});

test("collect finds this repo's assets", async () => {
  const inventory = await collect();

  expect(inventory.plugins.length).toBeGreaterThan(20);
  expect(inventory.skills.filter((s) => !s.modelInvocable)).not.toBeEmpty();
  expect(new Set(inventory.hooks.map((h) => h.scope))).toEqual(
    new Set(["plugin", "user", "project"]),
  );
});
