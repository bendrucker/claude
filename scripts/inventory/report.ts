import { getBorderCharacters, table } from "table";
import { SCOPES } from "../assets";
import type { Inventory } from "./collect";

export const KINDS = [
  "summary",
  "plugins",
  "skills",
  "agents",
  "commands",
  "hooks",
  "rules",
  "mcp",
] as const;

export type Kind = (typeof KINDS)[number];

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export interface Section {
  kind: Kind;
  head: string[];
  rows: string[][];
}

type Columns = Omit<Section, "kind">;

function flag(value: boolean): string {
  return value ? "yes" : "-";
}

function truncate(value: string, limit: number): string {
  if (limit <= 0 || value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function skillDir(path: string): string {
  return path.replace(/\/SKILL\.md$/, "");
}

function invocation(skill: { modelInvocable: boolean; userInvocable: boolean }): string {
  const modes = [skill.modelInvocable && "model", skill.userInvocable && "user"].filter(Boolean);
  return modes.join("+") || "none";
}

function counts(inventory: Inventory): Columns {
  const scoped = [
    { kind: "skills", items: inventory.skills },
    { kind: "agents", items: inventory.agents },
    { kind: "commands", items: inventory.commands },
    { kind: "rules", items: inventory.rules },
    { kind: "hooks", items: inventory.hooks },
  ];

  // Plugins and MCP servers exist only in the plugin scope, so their row skips
  // the per-scope split the others break down by.
  const pluginOnly = (kind: string, total: number, note: string): string[] => [
    kind,
    String(total),
    "-",
    "-",
    String(total),
    note,
  ];

  return {
    head: ["kind", "plugin", "user", "project", "total", "note"],
    rows: [
      pluginOnly(
        "plugins",
        inventory.plugins.length,
        `${inventory.plugins.filter((p) => p.enabled).length} enabled`,
      ),
      ...scoped.map(({ kind, items }) => [
        kind,
        ...SCOPES.map((scope) => String(items.filter((item) => item.scope === scope).length)),
        String(items.length),
        "",
      ]),
      pluginOnly("mcp", inventory.mcpServers.length, ""),
    ],
  };
}

export function section(inventory: Inventory, kind: Kind, width: number): Section {
  return { kind, ...columns(inventory, kind, width) };
}

function columns(inventory: Inventory, kind: Kind, width: number): Columns {
  const cut = (value: string): string => truncate(value, width);

  switch (kind) {
    case "summary":
      return counts(inventory);
    case "plugins":
      return {
        head: ["plugin", "on", "listed", "skills", "agents", "cmds", "hooks", "mcp", "description"],
        rows: inventory.plugins.map((p) => {
          // A plugin listed from a remote source has nothing to count here.
          const count = (value: number): string => (p.local ? String(value) : "-");
          return [
            p.name,
            flag(p.enabled),
            flag(p.listed),
            count(p.skills),
            count(p.agents),
            count(p.commands),
            count(p.hooks),
            count(p.mcpServers),
            cut(p.description),
          ];
        }),
      };
    case "skills":
      return {
        head: ["skill", "invoke", "directory", "description"],
        rows: inventory.skills.map((s) => [
          s.name,
          invocation(s),
          skillDir(s.path),
          cut(s.description),
        ]),
      };
    case "agents":
      return {
        head: ["agent", "model", "tools", "path", "description"],
        rows: inventory.agents.map((a) => [
          a.name,
          a.model || "-",
          cut(a.tools) || "all",
          a.path,
          cut(a.description),
        ]),
      };
    case "commands":
      return {
        head: ["command", "path", "description"],
        rows: inventory.commands.map((c) => [c.name, c.path, cut(c.description)]),
      };
    case "hooks":
      return {
        head: ["event", "matcher", "when", "source", "command"],
        rows: inventory.hooks.map((h) => [
          h.event,
          cut(h.matcher),
          cut(h.condition) || "-",
          h.path,
          cut(h.command),
        ]),
      };
    case "rules":
      return {
        head: ["rule", "path", "applies to"],
        rows: inventory.rules.map((r) => [r.name, r.path, cut(r.paths.join(", ") || "always")]),
      };
    case "mcp":
      return {
        head: ["server", "plugin", "path"],
        rows: inventory.mcpServers.map((m) => [m.name, m.plugin, m.path]),
      };
  }
}

/** The records behind a kind, for `--json`. */
// The shape varies by `kind`, and the only caller passes the result straight
// to JSON.stringify for --json.
// oxlint-disable-next-line local/no-unknown-returns
export function records(inventory: Inventory, kind: Kind): unknown {
  if (kind === "summary") return inventory;
  if (kind === "mcp") return inventory.mcpServers;
  return inventory[kind];
}

export function render({ kind, head, rows }: Section): string {
  if (rows.length === 0) return `No ${kind} found.`;

  // Rules between every row would double the line count of a listing that
  // lands in a context window.
  return table([head, ...rows], {
    border: getBorderCharacters("norc"),
    drawHorizontalLine: (index, size) => index === 0 || index === 1 || index === size,
  }).trimEnd();
}
