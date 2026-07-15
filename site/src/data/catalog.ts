import { join } from "node:path";
import type { MarketplaceListing, Plugin, PluginSource } from "../../../packages/marketplace/index";
import { loadPlugins } from "../../../packages/marketplace/index";
import type { PluginHistory } from "./history";
import { loadHistory } from "./history";
import type { ComponentSummary, HooksSummary, SkillSummary, TsFileSummary } from "./plugin-files";
import { countCommands, scanAgents, scanHooks, scanSkills, scanTsFiles } from "./plugin-files";
import { pluginRoute } from "./routes";

export type { ComponentSummary, HooksSummary, SkillSummary, TsFileSummary } from "./plugin-files";
export { githubBlobUrl, repoPathToRoute } from "./routes";

export interface CatalogAuthor {
  name: string;
  email?: string;
}

export interface CatalogPlugin {
  name: string;
  description?: string;
  category?: string;
  keywords: string[];
  source: PluginSource;
  local: boolean;
  route: string;
  /** Repo-relative README path, the one markdown body the site renders. Absent for remote plugins. */
  readmePath?: string;
  author?: CatalogAuthor;
  dependencies: string[];
  skills: SkillSummary[];
  commandCount: number;
  agents: ComponentSummary[];
  hooks?: HooksSummary;
  mcpServers: string[];
  history?: PluginHistory;
  tsFiles: TsFileSummary[];
}

export interface Catalog {
  plugins: CatalogPlugin[];
}

export interface LoadCatalogOptions {
  root?: string;
}

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..", "..");

// loadPlugins() defaults to reading the real user/settings.json to compute
// `enabled`, which must never reach the published catalog. Pointing it at a
// path that can never exist keeps `enabled` false for every plugin without
// this module ever having to read (and then discard) real settings.
const NO_SETTINGS_PATH = join(PACKAGE_ROOT, ".catalog-never-reads-settings.json");

function parseAuthor(value: unknown): CatalogAuthor | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string") return undefined;
  const email = record.email;
  return typeof email === "string" ? { name, email } : { name };
}

function parseDependencies(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

type ListedPlugin = Plugin & { listing: MarketplaceListing };

function isListed(plugin: Plugin): plugin is ListedPlugin {
  return plugin.listing !== undefined;
}

/**
 * Builds one catalog entry field by field so `Plugin.enabled` and
 * `Plugin.dir` (an absolute `/Users/...` path) can never leak into the
 * public record: spreading `plugin` here would defeat that guarantee.
 */
async function buildCatalogPlugin(
  plugin: ListedPlugin,
  history: Map<string, PluginHistory>,
): Promise<CatalogPlugin> {
  const { listing } = plugin;
  const author = parseAuthor(plugin.manifest?.author);
  const dependencies = parseDependencies(plugin.manifest?.dependencies);

  let skills: SkillSummary[] = [];
  let commandCount = 0;
  let agents: ComponentSummary[] = [];
  let hooks: HooksSummary | undefined;
  let tsFiles: TsFileSummary[] = [];
  let readmePath: string | undefined;

  if (plugin.dir) {
    let hasReadme = false;
    [skills, commandCount, agents, hooks, tsFiles, hasReadme] = await Promise.all([
      scanSkills(plugin.dir, plugin.name),
      countCommands(plugin.dir),
      scanAgents(plugin.dir, plugin.name),
      scanHooks(plugin.dir, plugin.name),
      scanTsFiles(plugin.dir, plugin.name),
      Bun.file(join(plugin.dir, "README.md")).exists(),
    ]);
    if (hasReadme) readmePath = `plugins/${plugin.name}/README.md`;
  }

  return {
    name: plugin.name,
    description: listing.description,
    category: listing.category,
    keywords: listing.keywords ?? [],
    source: listing.source,
    local: listing.local,
    route: pluginRoute(plugin.name),
    readmePath,
    author,
    dependencies,
    skills,
    commandCount,
    agents,
    hooks,
    mcpServers: plugin.mcpServers,
    history: history.get(plugin.name),
    tsFiles,
  };
}

/**
 * The single source of truth for the plugin index, detail pages, and the
 * published `plugins.json` artifact. Every plugin here is one listed in
 * `.claude-plugin/marketplace.json`; local component data (skills, agents,
 * hooks, TS inventory) is scanned from disk rather than extended onto
 * {@link loadPlugins}, which stays a lean config-surface joiner for the
 * repo's `check-*.ts` scripts.
 */
export async function loadCatalog(opts?: LoadCatalogOptions): Promise<Catalog> {
  const root = opts?.root ?? PACKAGE_ROOT;

  const plugins = (await loadPlugins({ root, settingsPath: NO_SETTINGS_PATH })).filter(isListed);

  const names = plugins.filter((plugin) => plugin.dir !== undefined).map((plugin) => plugin.name);
  const history = await loadHistory(names, { root });

  const catalogPlugins = await Promise.all(
    plugins.map((plugin) => buildCatalogPlugin(plugin, history)),
  );

  return { plugins: catalogPlugins };
}
