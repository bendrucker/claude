import { join } from "node:path";

export type PluginEntry = {
  id: string;
  name: string;
  description: string;
};

const thirdPartyDescriptions: Record<string, string> = {
  "pr-review-toolkit@claude-plugins-official":
    "PR review agents for code, tests, types, and comments",
  "linear@claude-plugins-official": "Official Linear integration",
  "github@claude-plugins-official": "Official GitHub integration",
  "astral@astral-sh": "Python tooling (ruff, uv, ty)",
  "ast-grep@ast-grep": "Structural code search and transform",
  "worktrunk@worktrunk": "Git worktree management CLI",
  "playground@claude-plugins-official": "Interactive HTML playground creator",
  "linear-cli@schpet": "Linear CLI integration",
};

export async function loadPluginCatalog(
  settingsPath: string,
  marketplacePath: string,
): Promise<PluginEntry[]> {
  const [settings, marketplace] = await Promise.all([
    Bun.file(settingsPath).json(),
    Bun.file(marketplacePath).json(),
  ]);
  const enabledPlugins: Record<string, boolean> = settings.enabledPlugins ?? {};
  const marketplacePlugins: Array<{ name: string; description: string }> =
    marketplace.plugins ?? [];

  const marketplaceByName = new Map(marketplacePlugins.map((p) => [p.name, p.description]));

  const entries: PluginEntry[] = [];

  for (const [id, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue;

    const parts = id.split("@");
    const name = parts[0] ?? id;
    const market = parts[1];
    let description: string;

    if (market === "bendrucker") {
      description = marketplaceByName.get(name) ?? name;
    } else {
      description = thirdPartyDescriptions[id] ?? name;
    }

    entries.push({ id, name, description });
  }

  return entries;
}

export function defaultPaths() {
  const home = process.env.HOME ?? "";
  return {
    settingsPath: join(home, ".claude", "settings.json"),
    marketplacePath: join(import.meta.dirname, "..", "..", ".claude-plugin", "marketplace.json"),
  };
}
