import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

interface PluginEntry {
  name: string;
  source: string | { source: string; repo: string };
}

interface Marketplace {
  plugins: PluginEntry[];
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

  let plugins: string[];
  if (changedFiles.length > 0) {
    if (matchesAlwaysPaths(changedFiles, alwaysPaths)) {
      plugins = allPlugins;
    } else {
      const changedPlugins = extractPluginNames(changedFiles);
      plugins = allPlugins.filter((p) => changedPlugins.includes(p));
    }
  } else {
    plugins = allPlugins;
  }

  console.log(JSON.stringify(plugins));
}

main();
