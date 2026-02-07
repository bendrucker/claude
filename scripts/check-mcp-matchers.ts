#!/usr/bin/env bun

import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

interface MatcherEntry {
  matcher: string;
  hooks: unknown[];
}

interface HooksFile {
  hooks: Record<string, Array<MatcherEntry | Record<string, unknown>>>;
}

interface PluginMcp {
  pluginName: string;
  serverNames: string[];
}

const MCP_PATTERN = /^mcp__(?!plugin_)(\w+)__(.+)$/;

function discoverPluginMcpServers(): PluginMcp[] {
  const results: PluginMcp[] = [];
  const mcpFiles = globSync("plugins/*/.mcp.json", { cwd: root });
  for (const mcpFile of mcpFiles) {
    const pluginDir = mcpFile.split("/")[1];
    if (!pluginDir) continue;
    const pluginJsonPath = join(root, "plugins", pluginDir, ".claude-plugin", "plugin.json");
    if (!existsSync(pluginJsonPath)) continue;

    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
    const mcpJson = JSON.parse(readFileSync(join(root, mcpFile), "utf8"));

    results.push({
      pluginName: pluginJson.name,
      serverNames: Object.keys(mcpJson),
    });
  }
  return results;
}

function discoverEnabledPluginNames(): Set<string> {
  const names = new Set<string>();
  const settingsPath = join(root, "user", "settings.json");
  if (!existsSync(settingsPath)) return names;

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const enabled = settings.enabledPlugins ?? {};
  for (const key of Object.keys(enabled)) {
    if (!enabled[key]) continue;
    const name = key.split("@")[0];
    if (!name) continue;
    names.add(name);
  }
  return names;
}

function collectMatchers(): Array<{ file: string; matcher: string }> {
  const results: Array<{ file: string; matcher: string }> = [];
  const hooksFiles = globSync("plugins/*/hooks/hooks.json", { cwd: root });
  for (const file of hooksFiles) {
    const content: HooksFile = JSON.parse(readFileSync(join(root, file), "utf8"));
    for (const entries of Object.values(content.hooks)) {
      for (const entry of entries) {
        if ("matcher" in entry && typeof entry.matcher === "string") {
          results.push({ file, matcher: entry.matcher });
        }
      }
    }
  }
  return results;
}

function checkMatchers() {
  const localMcp = discoverPluginMcpServers();
  const enabledNames = discoverEnabledPluginNames();

  // Build a set of server names that come from known plugins
  const knownServers = new Map<string, string>();
  for (const { pluginName, serverNames } of localMcp) {
    for (const server of serverNames) {
      knownServers.set(server, pluginName);
    }
  }

  const matchers = collectMatchers();
  const errors: string[] = [];

  for (const { file, matcher } of matchers) {
    const patterns = matcher.split("|");

    for (const pattern of patterns) {
      const match = MCP_PATTERN.exec(pattern);
      if (!match) continue;

      const server = match[1];
      const tool = match[2];
      if (!server || !tool) continue;

      // Determine plugin name: use known mapping, or fall back to
      // enabled plugin names that match the server name
      const pluginName = knownServers.get(server) ?? (enabledNames.has(server) ? server : null);
      if (!pluginName) continue;

      const pluginVariant = `mcp__plugin_${pluginName}_${server}__${tool}`;
      if (!patterns.includes(pluginVariant)) {
        errors.push(`${file}: matcher "${pattern}" is missing plugin variant "${pluginVariant}"`);
      }
    }
  }

  return errors;
}

const errors = checkMatchers();
if (errors.length > 0) {
  console.log("MCP hook matchers missing plugin variants:");
  for (const err of errors) {
    console.log(`  ${err}`);
  }
  process.exit(1);
}

console.log("All MCP hook matchers include plugin variants");
