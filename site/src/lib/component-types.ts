import type { CatalogPlugin } from "../data/catalog";

/** Icon names, keyed to the `lucide-astro` components a card is allowed to render. */
export type ComponentIconName = "Sparkles" | "Terminal" | "Bot" | "Webhook" | "Plug" | "Github";

export interface ComponentTypeRow {
  key: string;
  iconName?: ComponentIconName;
  count: (plugin: CatalogPlugin) => number;
  label: string | ((count: number) => string);
  /** A plugin either is remote or it is not, so a "1" would say nothing. Marker rows show the icon alone. */
  marker?: true;
}

function plural(word: string, count: number): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * One row per upstream plugin component type. A new type ships as a new row
 * here rather than a new branch scattered across the card and detail views.
 * The six rows with an `iconName` are backed by fields the catalog already
 * scans. The rest are forward-compatible placeholders that render zero chips
 * until the data layer scans them.
 */
export const COMPONENT_TYPES: ComponentTypeRow[] = [
  {
    key: "skills",
    iconName: "Sparkles",
    count: (plugin) => plugin.skills.length,
    label: (n) => plural("skill", n),
  },
  {
    key: "commands",
    iconName: "Terminal",
    count: (plugin) => plugin.commandCount,
    label: (n) => plural("command", n),
  },
  {
    key: "agents",
    iconName: "Bot",
    count: (plugin) => plugin.agents.length,
    label: (n) => plural("agent", n),
  },
  {
    key: "hooks",
    iconName: "Webhook",
    count: (plugin) => plugin.hooks?.events.length ?? 0,
    label: (n) => plural("hook event", n),
  },
  {
    key: "mcpServers",
    iconName: "Plug",
    count: (plugin) => plugin.mcpServers.length,
    label: (n) => plural("MCP server", n),
  },
  {
    key: "remote",
    iconName: "Github",
    count: (plugin) => (plugin.local ? 0 : 1),
    label: "Hosted on GitHub",
    marker: true,
  },
  { key: "lspServers", count: () => 0, label: "LSP servers" },
  { key: "outputStyles", count: () => 0, label: "Output styles" },
  { key: "themes", count: () => 0, label: "Themes" },
  { key: "channels", count: () => 0, label: "Channels" },
  { key: "settings", count: () => 0, label: "Settings" },
  { key: "userConfig", count: () => 0, label: "User config" },
];

export interface Chip {
  key: string;
  iconName?: ComponentIconName;
  /** The chip's whole meaning in words, e.g. `3 skills`. The icon carries it visually, so this is what a screen reader reads. */
  label: string;
  /** Absent on marker rows, which show no number. */
  count?: number;
}

/** Every chip a plugin card or detail view should render, skipping zero-count rows. */
export function chipsFor(plugin: CatalogPlugin): Chip[] {
  return COMPONENT_TYPES.map((row) => ({ row, count: row.count(plugin) }))
    .filter(({ count }) => count > 0)
    .map(({ row, count }) => ({
      key: row.key,
      ...(row.iconName !== undefined ? { iconName: row.iconName } : {}),
      label: typeof row.label === "function" ? row.label(count) : row.label,
      ...(row.marker ? {} : { count }),
    }));
}
