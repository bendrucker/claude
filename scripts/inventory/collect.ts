import { basename, join } from "node:path";
import matter from "gray-matter";
import { loadPlugins } from "../../packages/marketplace/index";
import {
  AGENT_GLOBS,
  COMMAND_GLOBS,
  namespaced,
  type Origin,
  origin,
  RULE_GLOBS,
  readAll,
  root,
  type Scope,
  SKILL_GLOBS,
  skillName,
} from "../assets";

export interface Skill extends Origin {
  name: string;
  description: string;
  modelInvocable: boolean;
  userInvocable: boolean;
}

export interface Agent extends Origin {
  name: string;
  description: string;
  model: string;
  tools: string;
}

export interface Command extends Origin {
  name: string;
  description: string;
}

export interface Hook extends Origin {
  event: string;
  matcher: string;
  /** The `if` guard that decides whether the command runs, empty when unguarded. */
  condition: string;
  command: string;
}

export interface Rule extends Origin {
  name: string;
  paths: string[];
}

export interface McpServer {
  name: string;
  plugin: string;
  path: string;
}

export interface PluginSummary {
  name: string;
  description: string;
  enabled: boolean;
  listed: boolean;
  /** Present under `plugins/`, as opposed to listed from a remote source. */
  local: boolean;
  skills: number;
  agents: number;
  commands: number;
  hooks: number;
  mcpServers: number;
}

export interface Inventory {
  plugins: PluginSummary[];
  skills: Skill[];
  agents: Agent[];
  commands: Command[];
  hooks: Hook[];
  rules: Rule[];
  mcpServers: McpServer[];
}

type Frontmatter = Record<string, unknown>;

async function frontmatter(path: string): Promise<Frontmatter> {
  return matter(await Bun.file(join(root, path)).text()).data;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Tool lists appear as a comma-joined string or a YAML sequence. */
function toolList(value: unknown): string {
  return Array.isArray(value) ? value.map(text).join(", ") : text(value);
}

/**
 * Only `hooks.json` is schema-validated. Skill frontmatter and the settings
 * files reach here as raw YAML and JSON, so nothing below the event key is
 * guaranteed to exist or to have the right shape.
 */
type HookEvents = Record<
  string,
  Array<{ matcher?: string; hooks?: Array<{ type: string; command?: string; if?: string }> }>
>;

/** Every hook a settings, plugin, or skill manifest registers, one row per command. */
export function* hookEntries(source: string, events: HookEvents): Generator<Hook> {
  const from = origin(source);

  for (const [event, entries] of Object.entries(events)) {
    if (!Array.isArray(entries)) continue;

    for (const entry of entries) {
      for (const hook of entry?.hooks ?? []) {
        yield {
          ...from,
          event,
          matcher: entry.matcher ?? "*",
          condition: text(hook.if),
          command: text(hook.command) || hook.type,
        };
      }
    }
  }
}

/** A skill's own record plus any hooks its frontmatter registers, from one parse. */
async function readSkill(path: string): Promise<{ skill: Skill; hooks: Hook[] }> {
  const data = await frontmatter(path);
  const events = data.hooks as HookEvents | undefined;

  return {
    skill: {
      ...origin(path),
      name: skillName(path, data.name as string | undefined),
      description: text(data.description),
      modelInvocable: data["disable-model-invocation"] !== true,
      userInvocable: data["user-invocable"] !== false,
    },
    hooks: events ? [...hookEntries(path, events)] : [],
  };
}

async function readAgent(path: string): Promise<Agent> {
  const data = await frontmatter(path);
  const allowed = toolList(data.tools);
  const denied = toolList(data.disallowedTools);

  return {
    ...origin(path),
    name: namespaced(path, text(data.name) || basename(path, ".md")),
    description: text(data.description),
    model: text(data.model),
    tools: allowed || (denied ? `all except ${denied}` : ""),
  };
}

/** Subdirectories under `commands/` are colons in the name Claude Code registers. */
function commandName(path: string): string {
  const segments = path.split("/");
  return segments
    .slice(segments.indexOf("commands") + 1)
    .join(":")
    .replace(/\.md$/, "");
}

async function readCommand(path: string): Promise<Command> {
  const data = await frontmatter(path);
  return {
    ...origin(path),
    name: namespaced(path, text(data.name) || commandName(path)),
    description: text(data.description),
  };
}

async function readRule(path: string): Promise<Rule> {
  const data = await frontmatter(path);
  return {
    ...origin(path),
    name: basename(path, ".md"),
    paths: Array.isArray(data.paths) ? data.paths.map(text) : [],
  };
}

// The settings files Claude Code reads for this repo. Plugin and skill hooks
// come from their own manifests.
const SETTINGS_FILES = [
  "user/settings.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
];

async function settingsHooks(path: string): Promise<Hook[]> {
  const file = Bun.file(join(root, path));
  if (!(await file.exists())) return [];

  const settings = (await file.json()) as { hooks?: HookEvents };
  return [...hookEntries(path, settings.hooks ?? {})];
}

export interface Filters {
  plugin?: string;
  scope?: Scope;
}

export function filter(inventory: Inventory, { plugin, scope }: Filters): Inventory {
  const keep = (item: Origin): boolean =>
    (!plugin || item.plugin === plugin) && (!scope || item.scope === scope);

  // Plugins and their MCP servers have no scope of their own. They are the plugin scope.
  const named = (name: string): boolean =>
    (!plugin || name === plugin) && (!scope || scope === "plugin");

  return {
    plugins: inventory.plugins.filter((item) => named(item.name)),
    skills: inventory.skills.filter(keep),
    agents: inventory.agents.filter(keep),
    commands: inventory.commands.filter(keep),
    rules: inventory.rules.filter(keep),
    hooks: inventory.hooks.filter(keep),
    mcpServers: inventory.mcpServers.filter((item) => named(item.plugin)),
  };
}

function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export async function collect(): Promise<Inventory> {
  const [plugins, fromSkills, agents, commands, rules, settings] = await Promise.all([
    loadPlugins({ root }),
    readAll(SKILL_GLOBS, readSkill),
    readAll(AGENT_GLOBS, readAgent),
    readAll(COMMAND_GLOBS, readCommand),
    readAll(RULE_GLOBS, readRule),
    Promise.all(SETTINGS_FILES.map(settingsHooks)),
  ]);

  const skills = fromSkills.map(({ skill }) => skill);
  const hooks = [
    ...plugins.flatMap((plugin) =>
      plugin.hooks
        ? [...hookEntries(`plugins/${plugin.name}/hooks/hooks.json`, plugin.hooks.hooks)]
        : [],
    ),
    ...fromSkills.flatMap(({ hooks }) => hooks),
    ...settings.flat(),
  ];

  const owned = (items: Origin[], name: string): number =>
    items.filter((item) => item.plugin === name).length;

  return {
    plugins: plugins.map((plugin) => ({
      name: plugin.name,
      description: text(plugin.manifest?.description ?? plugin.listing?.description),
      enabled: plugin.enabled,
      listed: plugin.listing !== undefined,
      local: plugin.dir !== undefined,
      skills: owned(skills, plugin.name),
      agents: owned(agents, plugin.name),
      commands: owned(commands, plugin.name),
      hooks: owned(hooks, plugin.name),
      mcpServers: plugin.mcpServers.length,
    })),
    skills: byName(skills),
    agents: byName(agents),
    commands: byName(commands),
    hooks,
    rules: byName(rules),
    mcpServers: plugins.flatMap((plugin) =>
      plugin.mcpServers.map((name) => ({
        name,
        plugin: plugin.name,
        path: `plugins/${plugin.name}/.mcp.json`,
      })),
    ),
  };
}
