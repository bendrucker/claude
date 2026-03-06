import type { LaunchConfig } from "./schema";

export type CommandResult = {
  env: Record<string, string>;
  args: string[];
  display: string;
};

export function buildCommand(config: LaunchConfig): CommandResult {
  const env: Record<string, string> = {};
  const args = ["claude"];

  args.push("--model", config.model);

  if (config.effort !== "medium") {
    env.CLAUDE_CODE_EFFORT_LEVEL = config.effort;
  }

  if (config.disablePlugins.length > 0) {
    const pluginSettings: Record<string, boolean> = {};
    for (const plugin of config.disablePlugins) {
      pluginSettings[plugin] = false;
    }
    args.push("--settings", JSON.stringify({ enabledPlugins: pluginSettings }));
  }

  for (const tool of config.allowedTools) {
    args.push("--allowedTools", tool);
  }

  if (config.permissionMode === "plan") {
    args.push("--permission-mode", "plan");
  }

  if (config.systemPrompt) {
    args.push("--append-system-prompt", config.systemPrompt);
  }

  const display = formatDisplay(config, env, args);
  return { env, args, display };
}

function formatDisplay(config: LaunchConfig, env: Record<string, string>, args: string[]): string {
  const lines: string[] = [];

  lines.push(`Model:    ${config.model}`);
  lines.push(`Effort:   ${config.effort}`);

  if (config.disablePlugins.length > 0) {
    const names = config.disablePlugins.map((p) => `-${p.split("@")[0]}`);
    lines.push(`Plugins:  ${names.join(" ")}`);
  }

  if (config.allowedTools.length > 0) {
    const tools = config.allowedTools.map((t) => `+${t}`);
    lines.push(`Tools:    ${tools.join(" ")}`);
  }

  if (config.permissionMode !== "default") {
    lines.push(`Mode:     ${config.permissionMode}`);
  }

  lines.push("");
  lines.push(`> ${config.reasoning}`);
  lines.push("");

  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

  const cmdLine = args.map((a) => (a.includes(" ") || a.includes("{") ? `'${a}'` : a)).join(" ");

  lines.push(envPrefix ? `${envPrefix} ${cmdLine}` : cmdLine);

  return lines.join("\n");
}
