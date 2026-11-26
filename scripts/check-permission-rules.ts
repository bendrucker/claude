#!/usr/bin/env bun

import { join } from "node:path";
import { z } from "zod";
import { decodeJson } from "../packages/decode/index";
import { frontmatter, type Frontmatter } from "./assets";
import { readTracked, runCheck, tracked } from "./check";

// Claude Code warns on startup about Write(path), NotebookEdit(path), and
// Glob(path) permission rules: the permission system routes file writes
// through Edit(path) rules and Glob through Read(path) rules, so these forms
// never match. Hook matchers and `if` conditions are exempt because hooks
// match the tool actually invoked.
const DEPRECATED = /^(Write|NotebookEdit|Glob)\(/;

const REPLACEMENT: Record<string, string> = {
  Write: "Edit",
  NotebookEdit: "Edit",
  Glob: "Read",
};

// Claude Code warns on startup about a `*` inside a variable's value, as in
// `Bash(PORT=* npm run dev)`.
const WILDCARD_ASSIGNMENT = /^Bash\(\s*[A-Za-z_][A-Za-z0-9_]*=\S*\*/;

const root = join(import.meta.dirname, "..");

/** Claude Code's normalization of a server or plugin name inside a tool name. */
export function normalizeMcpName(name: string): string {
  return name.replaceAll(/[^A-Za-z0-9_-]/g, "_");
}

/**
 * A server a plugin's `.mcp.json` declares. Its tools are named
 * `mcp__plugin_<plugin>_<server>__<tool>`, and an MCP rule reaches only the
 * server it names, so `mcp__<server>` never matches them.
 */
export interface PluginServer {
  plugin: string;
  server: string;
}

export function pluginServerPrefix({ plugin, server }: PluginServer): string {
  return `mcp__plugin_${normalizeMcpName(plugin)}_${normalizeMcpName(server)}`;
}

export function ruleViolations(rules: string[], servers: PluginServer[]): string[] {
  const violations: string[] = [];
  for (const rule of rules) {
    if (DEPRECATED.test(rule)) {
      const tool = rule.slice(0, rule.indexOf("("));
      violations.push(`${rule} (use ${REPLACEMENT[tool]}(...) instead)`);
    }
    if (WILDCARD_ASSIGNMENT.test(rule)) {
      violations.push(`${rule} (a * in a variable's value is not matched; name the value)`);
    }
    for (const server of servers) {
      const bare = `mcp__${normalizeMcpName(server.server)}`;
      if (rule === bare || rule.startsWith(`${bare}__`)) {
        const tool = rule === bare ? "__*" : rule.slice(bare.length);
        violations.push(
          `${rule} (plugin ${server.plugin} hosts this server, so use ${pluginServerPrefix(server)}${tool})`,
        );
      }
    }
  }
  return violations;
}

const McpConfig = z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() });

async function pluginServers(): Promise<PluginServer[]> {
  const servers: PluginServer[] = [];
  for (const { file, raw } of await loadTracked("plugins/*/.mcp.json")) {
    if (raw === null) continue;
    const plugin = file.split("/")[1] ?? "";
    for (const server of Object.keys(decodeJson(McpConfig, raw, file).mcpServers ?? {})) {
      servers.push({ plugin, server });
    }
  }
  return servers;
}

/** A plugin's own files can only mean its own servers; settings can mean any plugin's. */
function serversFor(file: string, servers: PluginServer[]): PluginServer[] {
  const [top, plugin] = file.split("/");
  return top === "plugins" ? servers.filter((server) => server.plugin === plugin) : servers;
}

const Permissions = z.looseObject({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  ask: z.array(z.string()).optional(),
});

// The settings glob also matches the JSON Patch overlays, which are arrays.
const SettingsPermissions = z.union([
  z.looseObject({ permissions: Permissions.optional() }),
  z.array(z.unknown()).transform(() => ({ permissions: undefined })),
]);

async function loadTracked(pattern: string): Promise<{ file: string; raw: string | null }[]> {
  return Promise.all(
    (await tracked(pattern, root)).map(async (file) => ({
      file,
      raw: await readTracked(file, root),
    })),
  );
}

async function checkSettings(servers: PluginServer[]): Promise<string[]> {
  const violations: string[] = [];

  const settings = await loadTracked("*settings*.json");

  for (const { file, raw } of settings) {
    if (raw === null) continue;

    const { permissions } = decodeJson(SettingsPermissions, raw, file);
    if (!permissions) continue;

    for (const list of ["allow", "deny", "ask"] as const) {
      for (const violation of ruleViolations(permissions[list] ?? [], serversFor(file, servers))) {
        violations.push(`${file} (permissions.${list}): ${violation}`);
      }
    }
  }

  return violations;
}

function frontmatterRules(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").map((rule) => rule.trim());
  if (Array.isArray(value)) return value.filter((rule) => typeof rule === "string");
  return [];
}

async function checkFrontmatter(servers: PluginServer[]): Promise<string[]> {
  const violations: string[] = [];

  const markdown = await loadTracked("*.md");

  for (const { file, raw } of markdown) {
    if (raw === null || !raw.startsWith("---")) continue;

    let data: Frontmatter;
    try {
      data = frontmatter(raw, file);
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
      violations.push(`${file}: frontmatter failed to parse (${message})`);
      continue;
    }

    for (const key of ["allowed-tools", "tools"]) {
      for (const violation of ruleViolations(
        frontmatterRules(data[key]),
        serversFor(file, servers),
      )) {
        violations.push(`${file} (${key}): ${violation}`);
      }
    }
  }

  return violations;
}

if (import.meta.main) {
  await runCheck(
    async () => {
      const servers = await pluginServers();
      return {
        header: ["Permission rules that never match what they name:"],
        violations: [...(await checkSettings(servers)), ...(await checkFrontmatter(servers))],
      };
    },
    { success: "Every permission rule can match what it names" },
  );
}
