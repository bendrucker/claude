import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { decodeFile } from "../decode/index";

export const HookCommand = z.looseObject({
  type: z.string(),
  command: z.string(),
  /** Permission rule scoping the command, e.g. `Bash(gh pr create:*)`. */
  if: z.string().optional(),
});
export type HookCommand = z.infer<typeof HookCommand>;

export const MatcherEntry = z.looseObject({
  matcher: z.string().optional(),
  hooks: z.array(HookCommand),
});
export type MatcherEntry = z.infer<typeof MatcherEntry>;

export const HooksFile = z.looseObject({ hooks: z.record(z.string(), z.array(MatcherEntry)) });
export type HooksFile = z.infer<typeof HooksFile>;

export const PluginManifest = z.looseObject({ name: z.string() });
export type PluginManifest = z.infer<typeof PluginManifest>;

export const PluginSource = z.union([
  z.string(),
  z.looseObject({ source: z.string(), repo: z.string().optional() }),
]);
export type PluginSource = z.infer<typeof PluginSource>;

export interface MarketplaceListing {
  name: string;
  source: PluginSource;
  description?: string;
  /** Source is a local `./plugins/<name>` path rather than a remote reference. */
  local: boolean;
}

export interface Plugin {
  /** Canonical name: the directory basename for local plugins, the marketplace name otherwise. */
  name: string;
  /** Absolute path under `plugins/`, present when the plugin exists on disk. */
  dir?: string;
  /** Entry in `marketplace.json`, present when the plugin is published. */
  listing?: MarketplaceListing;
  /** `enabledPlugins["<name>@bendrucker"]` is `true` in settings. */
  enabled: boolean;
  manifest?: PluginManifest;
  hooks?: HooksFile;
  /** Server names declared in `.mcp.json` (empty when absent). */
  mcpServers: string[];
}

export interface HookCommandContext {
  /** e.g. "plugins/linear/hooks/hooks.json" */
  file: string;
  /** The raw matcher entry, for access to `.matcher`. */
  entry: MatcherEntry;
  command: HookCommand;
}

export interface MatcherEntryContext {
  file: string;
  entry: MatcherEntry;
}

/** Yields every hook command across a plugin's hooks file, tagged with its source file. */
export function* hookCommands(plugin: Plugin): Generator<HookCommandContext> {
  if (!plugin.hooks) return;
  const file = `plugins/${plugin.name}/hooks/hooks.json`;
  for (const entries of Object.values(plugin.hooks.hooks))
    for (const entry of entries) for (const command of entry.hooks) yield { file, entry, command };
}

/** Yields every matcher entry across a plugin's hooks file, tagged with its source file. */
export function* matcherEntries(plugin: Plugin): Generator<MatcherEntryContext> {
  if (!plugin.hooks) return;
  const file = `plugins/${plugin.name}/hooks/hooks.json`;
  for (const entries of Object.values(plugin.hooks.hooks))
    for (const entry of entries) yield { file, entry };
}

export interface LoadOptions {
  /** Repository root. Defaults to the repo containing this package. */
  root?: string;
  /** Path to the settings file read for enabled state. Defaults to `<root>/user/settings.json`. */
  settingsPath?: string;
}

const MarketplaceFile = z.looseObject({
  plugins: z.array(
    z.looseObject({ name: z.string(), source: PluginSource, description: z.string().optional() }),
  ),
});

export const SettingsFile = z.looseObject({
  enabledPlugins: z.record(z.string(), z.boolean()).optional(),
  extraKnownMarketplaces: z.record(z.string(), z.looseObject({})).optional(),
});
export type SettingsFile = z.infer<typeof SettingsFile>;

const McpFile = z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() });

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");

function repoRoot(opts?: LoadOptions): string {
  return opts?.root ?? PACKAGE_ROOT;
}

function settingsPathFor(root: string, opts?: LoadOptions): string {
  return opts?.settingsPath ?? join(root, "user", "settings.json");
}

async function readJson<S extends z.ZodType>(
  schema: S,
  path: string,
): Promise<z.output<S> | undefined> {
  if (!(await Bun.file(path).exists())) return undefined;
  return decodeFile(schema, path);
}

/**
 * Joins the three sources of truth for plugins (the `plugins/` directory, the
 * marketplace listing, and the enabled set in settings) into one record per
 * plugin. Presence flags (`dir`, `listing`, `enabled`) keep the disagreements
 * between sources legible: a plugin can exist on disk but not be listed, or be
 * listed remotely with no local directory.
 */
export async function loadPlugins(opts?: LoadOptions): Promise<Plugin[]> {
  const root = repoRoot(opts);
  const pluginsDir = join(root, "plugins");
  const marketplacePath = join(root, ".claude-plugin", "marketplace.json");
  const settingsPath = settingsPathFor(root, opts);

  const [marketplace, settings, entries] = await Promise.all([
    readJson(MarketplaceFile, marketplacePath),
    readJson(SettingsFile, settingsPath),
    readdir(pluginsDir, { withFileTypes: true }),
  ]);

  const enabled = settings?.enabledPlugins ?? {};
  const plugins = new Map<string, Plugin>();
  const get = (name: string): Plugin => {
    let plugin = plugins.get(name);
    if (!plugin) {
      plugin = { name, enabled: enabled[`${name}@bendrucker`] === true, mcpServers: [] };
      plugins.set(name, plugin);
    }
    return plugin;
  };

  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  await Promise.all(
    dirNames.map(async (name) => {
      const dir = join(pluginsDir, name);
      const plugin = get(name);
      plugin.dir = dir;

      const [manifest, hooks, mcp] = await Promise.all([
        readJson(PluginManifest, join(dir, ".claude-plugin", "plugin.json")),
        readJson(HooksFile, join(dir, "hooks", "hooks.json")),
        readJson(McpFile, join(dir, ".mcp.json")),
      ]);

      if (manifest) plugin.manifest = manifest;
      if (hooks) plugin.hooks = hooks;
      if (mcp?.mcpServers) plugin.mcpServers = Object.keys(mcp.mcpServers);
    }),
  );

  for (const entry of marketplace?.plugins ?? []) {
    const plugin = get(entry.name);
    const local = typeof entry.source === "string" && entry.source.startsWith("./plugins/");
    const listing: MarketplaceListing = { name: entry.name, source: entry.source, local };
    if (entry.description !== undefined) listing.description = entry.description;
    plugin.listing = listing;
  }

  return [...plugins.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The settings file read for enabled state, or an empty object when absent. */
export async function loadSettings(opts?: LoadOptions): Promise<SettingsFile> {
  const root = repoRoot(opts);
  return (await readJson(SettingsFile, settingsPathFor(root, opts))) ?? {};
}

/**
 * Base names of every enabled plugin across all marketplaces (e.g. `linear`
 * from `linear@bendrucker`). Broader than {@link Plugin.enabled}, which is
 * scoped to this repo's marketplace; used to resolve MCP server names that come
 * from plugins not present locally.
 */
export async function enabledPluginNames(opts?: LoadOptions): Promise<Set<string>> {
  const root = repoRoot(opts);
  const settings = await readJson(SettingsFile, settingsPathFor(root, opts));
  const names = new Set<string>();
  for (const [key, value] of Object.entries(settings?.enabledPlugins ?? {})) {
    if (!value) continue;
    const name = key.split("@")[0];
    if (name) names.add(name);
  }
  return names;
}
