import { describe, expect, test } from "bun:test";
import { type Catalog, loadCatalog } from "./catalog";

let cached: Promise<Catalog> | undefined;

function catalog(): Promise<Catalog> {
  if (!cached) cached = loadCatalog();
  return cached;
}

function find(plugins: Catalog["plugins"], name: string) {
  const plugin = plugins.find((p) => p.name === name);
  if (!plugin) throw new Error(`plugin ${name} not found in catalog`);
  return plugin;
}

describe("loadCatalog", () => {
  test("never leaks a filesystem path or the private enabled flag", async () => {
    const serialized = JSON.stringify(await catalog());
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/"enabled"/);
  });

  test("counts every listed plugin, split local vs remote", async () => {
    const { plugins } = await catalog();
    expect(plugins).toHaveLength(33);
    expect(plugins.filter((p) => p.local)).toHaveLength(31);
    expect(
      plugins
        .filter((p) => !p.local)
        .map((p) => p.name)
        .sort(),
    ).toEqual(["agents-md", "honeycomb"]);
  });

  test("counts components across the catalog", async () => {
    const { plugins } = await catalog();
    const totalSkills = plugins.reduce((n, p) => n + p.skills.length, 0);
    const totalCommands = plugins.reduce((n, p) => n + p.commandCount, 0);
    const totalAgents = plugins.reduce((n, p) => n + p.agents.length, 0);
    const totalHooks = plugins.filter((p) => p.hooks !== undefined).length;
    const totalMcpServers = plugins.filter((p) => p.mcpServers.length > 0).length;

    expect(totalSkills).toBe(56);
    expect(totalCommands).toBe(0);
    // Measured 10 real plugin agents (type-ignore/fixer, github/logs,
    // github/rulesets-manager, writing/{content,artifacts,style},
    // gitlab/logs, review/{angle,architect,verifier}); the brief's expected
    // count of 6 does not match disk.
    expect(totalAgents).toBe(10);
    expect(totalHooks).toBe(13);
    expect(totalMcpServers).toBe(1);
  });

  test("remote plugins install without a local dir, inventory, or history", async () => {
    const { plugins } = await catalog();
    for (const name of ["agents-md", "honeycomb"]) {
      const plugin = find(plugins, name);
      expect(plugin.local).toBe(false);
      expect(plugin.skills).toEqual([]);
      expect(plugin.commandCount).toBe(0);
      expect(plugin.agents).toEqual([]);
      expect(plugin.tsFiles).toEqual([]);
      expect(plugin.history).toBeUndefined();
    }
  });

  test("hooks-only plugins render no component chips", async () => {
    const { plugins } = await catalog();
    for (const name of ["go", "newline"]) {
      const plugin = find(plugins, name);
      expect(plugin.skills).toEqual([]);
      expect(plugin.commandCount).toBe(0);
      expect(plugin.agents).toEqual([]);
      expect(plugin.hooks).toBeDefined();
    }
  });

  test("summarizes hooks by event, however many matchers back them", async () => {
    const { plugins } = await catalog();

    // git registers one PreToolUse matcher, newline two PostToolUse matchers,
    // and tmux three events including matcher-less SessionStart and Stop. Each
    // collapses to one entry per event.
    expect(find(plugins, "git").hooks?.events).toEqual(["PreToolUse"]);
    expect(find(plugins, "newline").hooks?.events).toEqual(["PostToolUse", "PreToolUse"]);
    expect(find(plugins, "tmux").hooks?.events).toEqual(["PreToolUse", "SessionStart", "Stop"]);

    for (const plugin of plugins.filter((p) => p.hooks !== undefined)) {
      expect(plugin.hooks?.description).toBeTruthy();
      expect(plugin.hooks?.events.length).toBeGreaterThan(0);
    }
  });

  test("carries a README path for local plugins only", async () => {
    const { plugins } = await catalog();
    expect(find(plugins, "git").readmePath).toBe("plugins/git/README.md");
    expect(find(plugins, "agents-md").readmePath).toBeUndefined();
  });

  test("keeps skill and agent bodies out of the published catalog", async () => {
    const { plugins } = await catalog();
    const serialized = JSON.stringify(await catalog());

    // Skills and agents are frontmatter-only: name, description, and a source
    // link. Carrying bodies would put 626 KB of markdown into plugins.json.
    for (const plugin of plugins) {
      for (const component of [...plugin.skills, ...plugin.agents]) {
        expect(Object.keys(component).sort()).toEqual([
          "description",
          "githubBlobUrl",
          "name",
          "path",
        ]);
      }
    }
    expect(serialized.length).toBeLessThan(200_000);
  });

  test("terraform is the only plugin with an MCP server", async () => {
    const { plugins } = await catalog();
    const terraform = find(plugins, "terraform");
    expect(terraform.mcpServers).toEqual(["terraform"]);
    for (const plugin of plugins.filter((p) => p.name !== "terraform")) {
      expect(plugin.mcpServers).toEqual([]);
    }
  });

  test("models the two real plugin dependencies", async () => {
    const { plugins } = await catalog();
    expect(find(plugins, "issue").dependencies).toEqual(["pull-request"]);
    expect(find(plugins, "things").dependencies).toEqual(["mac"]);
    expect(find(plugins, "writing").dependencies).toEqual([]);
  });

  test("no catalog entry derives from a node_modules path", async () => {
    const { plugins } = await catalog();
    for (const plugin of plugins) {
      for (const file of [...plugin.skills, ...plugin.agents, ...plugin.tsFiles]) {
        expect(file.path).not.toMatch(/node_modules/);
      }
    }
  });
});
