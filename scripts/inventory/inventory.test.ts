import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  AGENT_GLOBS,
  assetPaths,
  isScope,
  namespaced,
  origin,
  RULE_GLOBS,
  root,
  SKILL_GLOBS,
  scopeOf,
} from "../assets";
import { collect, filter, hookEntries, type Inventory } from "./collect";
import { scanMod } from "./mods";
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
      mods: 0,
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
      mods: 0,
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
  mods: [
    {
      scope: "plugin",
      path: "plugins/git/mod/register.tsx",
      plugin: "git",
      events: ["session.start", "ui.render"],
      surfaces: ["AbovePrompt", "status"],
      description: "Shows the branch above the prompt",
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

test.each<{ name: string; kind: string; expected: boolean }>([
  { name: "known kind", kind: "skills", expected: true },
  { name: "unknown kind", kind: "wordlists", expected: false },
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
    mods: scoped.mods.length,
    mcpServers: scoped.mcpServers.length,
  }).toMatchInlineSnapshot(`
    {
      "agents": 0,
      "hooks": 1,
      "mcpServers": 0,
      "mods": 1,
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
  expect(scoped.mods).toBeEmpty();
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

await mkdir(join(root, "tmp"), { recursive: true });
const scratch = await mkdtemp(join(root, "tmp", "inventory-mod-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));

test("scanMod follows relative imports and names what the module draws", async () => {
  await mkdir(join(scratch, "mod"), { recursive: true });
  await Bun.write(
    join(scratch, "mod/register.tsx"),
    `import type { On } from "claude-code";
import { band } from "./band";
export { pane } from "./pane";

const dynamic = "turn.start";

export function register(on: On): void {
  on("session.start", ($, e, next) => { $.ui.status("ready"); return next(e); });
  on("ui.render", { component: "Pane", requestId: "x" }, ($, e, next) => next(e));
  on(dynamic, ($, e, next) => next(e));
  band(on);
}
`,
  );
  await Bun.write(
    join(scratch, "mod/band.ts"),
    `import type { On } from "claude-code";

export function band(on: On): void {
  on("ui.render", ($, e, next) => { $.ui.toast("hi"); return next(e); });
  on("session.start", ($, e, next) => next(e));
}
`,
  );

  await Bun.write(
    join(scratch, "mod/pane.ts"),
    `export function pane(on: On): void {
  on("command.run", ($, e, next) => next(e));
}
`,
  );

  expect(await scanMod(relative(root, join(scratch, "mod/register.tsx")))).toEqual({
    events: ["command.run", "session.start", "ui.render"],
    surfaces: ["Pane", "status", "toast", "ui.render"],
  });
});

test("scanMod rejects a module path that names no file", async () => {
  const failure = await scanMod(relative(root, join(scratch, "missing.ts"))).catch(
    (error: unknown) => error,
  );

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toContain("mod module not found");
});

test("collect lists the mods this repo's plugins name", async () => {
  const { mods } = await collect();
  const herdr = mods.find((mod) => mod.plugin === "herdr");

  expect(herdr?.path).toBe("plugins/herdr/mod/register.ts");
  expect(herdr?.events).toContain("session.start");
});
