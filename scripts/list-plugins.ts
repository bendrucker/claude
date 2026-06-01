import { parseArgs } from "node:util";
import { loadPlugins } from "@bendrucker/claude-marketplace";

interface CiConfig {
  runner?: string;
}

interface PluginMatrix {
  name: string;
  runner: string;
}

async function getLocalPlugins(): Promise<string[]> {
  const plugins = await loadPlugins();
  return plugins.filter((p) => p.listing?.local).map((p) => p.name);
}

async function readCiConfig(plugin: string): Promise<CiConfig> {
  const file = Bun.file(`plugins/${plugin}/.ci.json`);
  if (!(await file.exists())) return {};
  return file.json();
}

async function toMatrixEntry(name: string): Promise<PluginMatrix> {
  const ci = await readCiConfig(name);
  return { name, runner: ci.runner ?? "ubuntu-latest" };
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

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      always: { type: "string", multiple: true, default: [] },
    },
    allowPositionals: true,
  });

  const alwaysPaths = values.always ?? [];
  const changedFiles = positionals;
  const allPlugins = await getLocalPlugins();

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

  console.log(JSON.stringify(await Promise.all(plugins.map(toMatrixEntry))));
}

main();
