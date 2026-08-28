#!/usr/bin/env bun

import { enabledPluginNames, loadPlugins, matcherEntries } from "../packages/marketplace/index";
import { runCheck } from "./check";

const MCP_PATTERN = /^mcp__(?!plugin_)(?!claude_ai_)(\w+)__(.+)$/;

const CLAUDE_AI_MAPPINGS: Record<string, { displayName: string; tools: Record<string, string> }> = {
  linear: {
    displayName: "Linear",
    tools: {
      create_issue: "save_issue",
    },
  },
};

async function checkMatchers(): Promise<string[]> {
  const [plugins, enabledNames] = await Promise.all([loadPlugins(), enabledPluginNames()]);

  // Server names that come from known local plugins
  const knownServers = new Map<string, string>();
  for (const plugin of plugins) {
    for (const server of plugin.mcpServers) {
      knownServers.set(server, plugin.manifest?.name ?? plugin.name);
    }
  }

  const errors: string[] = [];

  for (const plugin of plugins) {
    for (const { file, entry } of matcherEntries(plugin)) {
      if (typeof entry.matcher !== "string") continue;
      const patterns = entry.matcher.split("|");

      for (const pattern of patterns) {
        const match = MCP_PATTERN.exec(pattern);
        if (!match) continue;

        const server = match[1];
        const tool = match[2];
        if (server == null || server === "" || tool == null || tool === "") continue;

        const pluginName = knownServers.get(server) ?? (enabledNames.has(server) ? server : null);
        if (pluginName == null || pluginName === "") continue;

        const pluginVariant = `mcp__plugin_${pluginName}_${server}__${tool}`;
        if (!patterns.includes(pluginVariant)) {
          errors.push(`${file}: matcher "${pattern}" is missing plugin variant "${pluginVariant}"`);
        }

        const claudeAi = CLAUDE_AI_MAPPINGS[server];
        if (claudeAi) {
          const mappedTool = claudeAi.tools[tool] ?? tool;
          const claudeAiVariant = `mcp__claude_ai_${claudeAi.displayName}__${mappedTool}`;
          if (!patterns.includes(claudeAiVariant)) {
            errors.push(
              `${file}: matcher "${pattern}" is missing Claude AI variant "${claudeAiVariant}"`,
            );
          }
        }
      }
    }
  }

  return errors;
}

await runCheck(
  async () => ({
    header: "MCP hook matchers missing plugin variants:",
    violations: await checkMatchers(),
  }),
  { success: "All MCP hook matchers include plugin and Claude AI variants" },
);
