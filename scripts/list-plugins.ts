import { parseArgs } from "node:util";
import { z } from "zod";
import { decodeFile } from "../packages/decode/index";
import { loadPlugins } from "../packages/marketplace/index";

const CiConfig = z.looseObject({
  runner: z.string().optional(),
  /**
   * Paths outside the plugin whose change also selects it, such as the source
   * of a file the plugin keeps a checked copy of.
   */
  paths: z.array(z.string()).optional(),
});
type CiConfig = z.infer<typeof CiConfig>;

interface PluginMatrix {
  name: string;
  runner: string;
}

export interface Plugin {
  name: string;
  /** Out-of-plugin paths that select it, from `.ci.json`. */
  paths: string[];
}

async function readCiConfig(plugin: string): Promise<CiConfig> {
  const path = `plugins/${plugin}/.ci.json`;
  if (!(await Bun.file(path).exists())) return {};
  return decodeFile(CiConfig, path);
}

async function getLocalPlugins(): Promise<{ plugins: Plugin[]; configs: Map<string, CiConfig> }> {
  const listed = await loadPlugins();
  const names = listed.filter((p) => p.listing?.local).map((p) => p.name);
  const configs = new Map(
    await Promise.all(names.map(async (name) => [name, await readCiConfig(name)] as const)),
  );
  const plugins = names.map((name) => ({ name, paths: configs.get(name)?.paths ?? [] }));
  return { plugins, configs };
}

function toMatrixEntry(name: string, config: CiConfig | undefined): PluginMatrix {
  return { name, runner: config?.runner ?? "ubuntu-latest" };
}

function pluginNames(files: string[]): Set<string> {
  const plugins = new Set<string>();
  for (const file of files) {
    const match = file.match(/^plugins\/([^/]+)\//);
    if (match?.[1] != null && match[1] !== "") plugins.add(match[1]);
  }
  return plugins;
}

function underAny(files: string[], paths: string[]): boolean {
  return files.some((file) => paths.some((path) => file.startsWith(path)));
}

/**
 * Plugins whose jobs a change has to run: every plugin when nothing narrows the
 * set, otherwise the ones the changed files name directly or claim through their
 * own `.ci.json` paths.
 */
export function select(plugins: Plugin[], files: string[], alwaysPaths: string[]): string[] {
  const all = plugins.map((plugin) => plugin.name);
  if (files.length === 0 || underAny(files, alwaysPaths)) return all;

  const changed = pluginNames(files);
  return plugins
    .filter((plugin) => changed.has(plugin.name) || underAny(files, plugin.paths))
    .map((plugin) => plugin.name);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      always: { type: "string", multiple: true, default: [] },
    },
    allowPositionals: true,
  });

  const { plugins, configs } = await getLocalPlugins();
  const selected = select(plugins, positionals, values.always);

  console.log(JSON.stringify(selected.map((name) => toMatrixEntry(name, configs.get(name)))));
}

if (import.meta.main) await main();
