import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

interface PluginEntry {
  name: string;
  source: string | { source: string; repo: string };
}

interface Marketplace {
  plugins: PluginEntry[];
}

interface PluginMatrix {
  name: string;
  os: string;
}

export function detectOs(pluginName: string): string {
  const path = `plugins/${pluginName}/.claude-plugin/plugin.json`;
  if (!existsSync(path)) return "ubuntu-latest";
  const content = readFileSync(path, "utf8");
  const plugin = JSON.parse(content) as { description?: string };
  if (plugin.description && /macos/i.test(plugin.description)) {
    return "macos-latest";
  }
  return "ubuntu-latest";
}

function getLocalPlugins(): string[] {
  const content = readFileSync(".claude-plugin/marketplace.json", "utf8");
  const marketplace: Marketplace = JSON.parse(content);
  return marketplace.plugins
    .filter((p): p is PluginEntry & { source: string } => typeof p.source === "string")
    .map((p) => p.name);
}

function extractPluginNames(files: string[]): string[] {
  const plugins = new Set<string>();
  for (const file of files) {
    const match = file.match(/^plugins\/([^/]+)\//);
    if (match?.[1]) plugins.add(match[1]);
  }
  return [...plugins];
}

function matchesAlwaysPaths(files: string[], alwaysPaths: string[]): boolean {
  return files.some((file) => alwaysPaths.some((path) => file.startsWith(path)));
}

function main(): void {
  const { values, positionals } = parseArgs({
    options: {
      always: { type: "string", multiple: true, default: [] },
    },
    allowPositionals: true,
  });

  const alwaysPaths = values.always ?? [];
  const changedFiles = positionals;
  const allPlugins = getLocalPlugins();

  let names: string[];
  if (changedFiles.length > 0) {
    if (matchesAlwaysPaths(changedFiles, alwaysPaths)) {
      names = allPlugins;
    } else {
      const changedPlugins = extractPluginNames(changedFiles);
      names = allPlugins.filter((p) => changedPlugins.includes(p));
    }
  } else {
    names = allPlugins;
  }

  const plugins: PluginMatrix[] = names.map((name) => ({
    name,
    os: detectOs(name),
  }));

  console.log(JSON.stringify(plugins));
}

main();
