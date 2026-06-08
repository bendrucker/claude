import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enabledPluginNames,
  hookCommands,
  loadPlugins,
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

describe("loadPlugins", () => {
  test("returns one record per plugin across all sources, sorted by name", async () => {
    const plugins = await loadPlugins({ root });
    expect(plugins.map((p) => p.name)).toEqual(["alpha", "beta", "orphan", "remote-only"]);
  });

  test("joins a fully-present local plugin", async () => {
    const alpha = (await catalog()).get("alpha");
    expect(alpha?.dir).toBe(join(root, "plugins", "alpha"));
    expect(alpha?.listing?.local).toBe(true);
    expect(alpha?.listing?.description).toBe("Alpha plugin");
    expect(alpha?.enabled).toBe(true);
    expect(alpha?.manifest?.name).toBe("alpha");
    expect(alpha?.hooks?.hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(alpha?.mcpServers).toEqual(["alpha-server"]);
  });

  test("listed local plugin that is disabled", async () => {
    const beta = (await catalog()).get("beta");
    expect(beta?.dir).toBeDefined();
    expect(beta?.listing?.local).toBe(true);
    expect(beta?.enabled).toBe(false);
    expect(beta?.mcpServers).toEqual([]);
  });

  test("on-disk plugin missing from the marketplace keeps dir without listing", async () => {
    const orphan = (await catalog()).get("orphan");
    expect(orphan?.dir).toBeDefined();
    expect(orphan?.listing).toBeUndefined();
  });

  test("remote-sourced listing has no dir and is not local", async () => {
    const remote = (await catalog()).get("remote-only");
    expect(remote?.dir).toBeUndefined();
    expect(remote?.listing?.local).toBe(false);
    expect(remote?.listing?.source).toEqual({ source: "github", repo: "owner/remote-only" });
  });

  test("set differences the check scripts depend on", async () => {
    const plugins = await loadPlugins({ root });
    // check-marketplace: on disk but no local listing
    expect(plugins.filter((p) => p.dir && !p.listing?.local).map((p) => p.name)).toEqual([
      "orphan",
    ]);
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

describe("hookCommands", () => {
  test("yields one item for alpha plugin", async () => {
    const alpha = (await catalog()).get("alpha")!;
    const items = [...hookCommands(alpha)];
    expect(items).toHaveLength(1);
    expect(items[0]?.file).toBe("plugins/alpha/hooks/hooks.json");
    expect(items[0]?.entry.matcher).toBe("Bash");
    expect(items[0]?.command.command).toBe("bun x.ts");
  });

  test("yields nothing for plugin without hooks", async () => {
    const beta = (await catalog()).get("beta")!;
    expect([...hookCommands(beta)]).toHaveLength(0);
  });
});

describe("matcherEntries", () => {
  test("yields one entry for alpha plugin", async () => {
    const alpha = (await catalog()).get("alpha")!;
    const items = [...matcherEntries(alpha)];
    expect(items).toHaveLength(1);
    expect(items[0]?.file).toBe("plugins/alpha/hooks/hooks.json");
    expect(items[0]?.entry.matcher).toBe("Bash");
  });

  test("yields nothing for plugin without hooks", async () => {
    const beta = (await catalog()).get("beta")!;
    expect([...matcherEntries(beta)]).toHaveLength(0);
  });
});

describe("enabledPluginNames", () => {
  test("returns base names across all marketplaces, excluding disabled", async () => {
    const names = await enabledPluginNames({ root });
    expect(names.has("alpha")).toBe(true); // alpha@bendrucker: true
    expect(names.has("astral")).toBe(true); // astral@astral-sh: true (third-party)
    expect(names.has("beta")).toBe(false); // beta@bendrucker: false
  });
});
