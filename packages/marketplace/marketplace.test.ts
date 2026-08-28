import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enabledPluginNames,
  hookCommands,
  loadPlugins,
  type MatcherEntryContext,
  matcherEntries,
  type Plugin,
} from "./index";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "marketplace-test-"));

  // Fully present local plugin: on disk, listed, enabled, with hooks + mcp + manifest.
  await Bun.write(join(root, "plugins/alpha/.claude-plugin/plugin.json"), '{ "name": "alpha" }');
  await Bun.write(
    join(root, "plugins/alpha/hooks/hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bun x.ts" }] }],
      },
    }),
  );
  await Bun.write(
    join(root, "plugins/alpha/.mcp.json"),
    JSON.stringify({ mcpServers: { "alpha-server": { command: "x" } } }),
  );

  // Listed local plugin that is disabled.
  await Bun.write(join(root, "plugins/beta/.claude-plugin/plugin.json"), '{ "name": "beta" }');

  // On disk but missing from the marketplace.
  await Bun.write(join(root, "plugins/orphan/.claude-plugin/plugin.json"), '{ "name": "orphan" }');

  await Bun.write(
    join(root, ".claude-plugin/marketplace.json"),
    JSON.stringify({
      plugins: [
        { name: "alpha", source: "./plugins/alpha", description: "Alpha plugin" },
        { name: "beta", source: "./plugins/beta" },
        { name: "remote-only", source: { source: "github", repo: "owner/remote-only" } },
      ],
    }),
  );

  await Bun.write(
    join(root, "user/settings.json"),
    JSON.stringify({
      enabledPlugins: {
        "alpha@bendrucker": true,
        "beta@bendrucker": false,
        "astral@astral-sh": true,
      },
    }),
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function catalog(): Promise<Map<string, Plugin>> {
  const plugins = await loadPlugins({ root });
  return new Map(plugins.map((p) => [p.name, p]));
}

/**
 * Normalizes a plugin for snapshotting: strips the mkdtemp-based `dir` prefix
 * and flattens the nested hooks file down to the one matcher tests care about.
 */
function forSnapshot(plugin?: Plugin) {
  if (!plugin) return plugin;
  const { hooks, ...rest } = plugin;
  return {
    ...rest,
    dir: plugin.dir?.replace(root, "<root>"),
    hookMatcher: hooks?.hooks.PreToolUse?.[0]?.matcher,
  };
}

describe("loadPlugins", () => {
  test("returns one record per plugin across all sources, sorted by name", async () => {
    const plugins = await loadPlugins({ root });
    expect(plugins.map((p) => p.name)).toEqual(["alpha", "beta", "orphan", "remote-only"]);
  });

  test.each<{ name: string; title: string }>([
    { name: "alpha", title: "joins a fully-present local plugin" },
    { name: "beta", title: "listed local plugin that is disabled" },
    {
      name: "orphan",
      title: "on-disk plugin missing from the marketplace keeps dir without listing",
    },
    { name: "remote-only", title: "remote-sourced listing has no dir and is not local" },
  ])("$title", async ({ name }) => {
    const plugin = forSnapshot((await catalog()).get(name));
    expect(plugin).toMatchSnapshot();
  });

  test("set differences the check scripts depend on", async () => {
    const plugins = await loadPlugins({ root });
    // check-marketplace: on disk but no local listing
    expect(
      plugins.filter((p) => p.dir !== undefined && p.listing?.local !== true).map((p) => p.name),
    ).toEqual(["orphan"]);
    // check-enabled-plugins: listed but not enabled
    expect(plugins.filter((p) => p.listing && !p.enabled).map((p) => p.name)).toEqual([
      "beta",
      "remote-only",
    ]);
  });

  test("settingsPath override is honored", async () => {
    const plugins = await loadPlugins({ root, settingsPath: join(root, "user", "settings.json") });
    expect(plugins.find((p) => p.name === "alpha")?.enabled).toBe(true);
  });
});

describe.each<{ name: string; fn: (plugin: Plugin) => Generator<MatcherEntryContext> }>([
  { name: "hookCommands", fn: hookCommands },
  { name: "matcherEntries", fn: matcherEntries },
])("$name", ({ fn }) => {
  test("yields one entry for alpha plugin", async () => {
    const alpha = (await catalog()).get("alpha")!;
    const items = [...fn(alpha)];
    expect(items).toHaveLength(1);
    expect(items[0]?.file).toBe("plugins/alpha/hooks/hooks.json");
    expect(items[0]?.entry.matcher).toBe("Bash");
  });

  test("yields nothing for plugin without hooks", async () => {
    const beta = (await catalog()).get("beta")!;
    expect([...fn(beta)]).toHaveLength(0);
  });
});

test("hookCommands includes the matched hook command", async () => {
  const alpha = (await catalog()).get("alpha")!;
  const [item] = [...hookCommands(alpha)];
  expect(item?.command.command).toBe("bun x.ts");
});

describe("enabledPluginNames", () => {
  test("returns base names across all marketplaces, excluding disabled", async () => {
    const names = await enabledPluginNames({ root });
    expect(names.has("alpha")).toBe(true); // alpha@bendrucker: true
    expect(names.has("astral")).toBe(true); // astral@astral-sh: true (third-party)
    expect(names.has("beta")).toBe(false); // beta@bendrucker: false
  });
});
