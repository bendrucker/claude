import * as p from "@clack/prompts";
import type { PluginEntry } from "./plugins";
import type { LaunchConfig } from "./schema";

const models = ["haiku", "sonnet", "opus"] as const;
const efforts = ["low", "medium", "high"] as const;
const permissionModes = ["default", "plan"] as const;

const toolPatterns = [
  "Bash(git:*)",
  "Bash(go:*)",
  "Bash(bun:*)",
  "Bash(npm:*)",
  "Bash(gh:*)",
  "Bash(glab:*)",
];

export type TuiResult = {
  config: LaunchConfig;
  worktree?: string;
  createBranch: boolean;
};

export type PresentConfigOptions = {
  existingRef?: string;
};

export async function presentConfig(
  aiConfig: LaunchConfig,
  plugins: PluginEntry[],
  options?: PresentConfigOptions,
): Promise<TuiResult | symbol> {
  const model = await p.select({
    message: "Model",
    initialValue: aiConfig.model,
    options: models.map((m) => ({ value: m, label: m })),
  });
  if (p.isCancel(model)) return model;

  const effort = await p.select({
    message: "Effort",
    initialValue: aiConfig.effort,
    options: efforts.map((e) => ({ value: e, label: e })),
  });
  if (p.isCancel(effort)) return effort;

  const permissionMode = await p.select({
    message: "Permission mode",
    initialValue: aiConfig.permissionMode,
    options: permissionModes.map((m) => ({ value: m, label: m })),
  });
  if (p.isCancel(permissionMode)) return permissionMode;

  const disablePlugins = await p.multiselect({
    message: "Disable plugins",
    initialValues: aiConfig.disablePlugins,
    options: plugins.map((plugin) => ({
      value: plugin.id,
      label: plugin.name,
      hint: plugin.description,
    })),
    required: false,
  });
  if (p.isCancel(disablePlugins)) return disablePlugins;

  const allowedTools = await p.multiselect({
    message: "Pre-approve tools",
    initialValues: aiConfig.allowedTools,
    options: toolPatterns.map((t) => ({ value: t, label: t })),
    required: false,
  });
  if (p.isCancel(allowedTools)) return allowedTools;

  const systemPrompt = await p.text({
    message: "System prompt (optional)",
    initialValue: aiConfig.systemPrompt ?? "",
    placeholder: "Leave empty to skip",
  });
  if (p.isCancel(systemPrompt)) return systemPrompt;

  if (options?.existingRef) {
    return {
      config: {
        model,
        effort,
        permissionMode,
        disablePlugins,
        allowedTools,
        branchName: options.existingRef,
        ...(systemPrompt ? { systemPrompt } : {}),
        reasoning: aiConfig.reasoning,
      },
      worktree: options.existingRef,
      createBranch: false,
    };
  }

  const useWorktree = await p.confirm({
    message: "Create worktree?",
    initialValue: true,
  });
  if (p.isCancel(useWorktree)) return useWorktree;

  let worktree: string | undefined;
  if (useWorktree) {
    const branchName = await p.text({
      message: "Branch name",
      initialValue: aiConfig.branchName,
    });
    if (p.isCancel(branchName)) return branchName;
    worktree = branchName;
  }

  return {
    config: {
      model,
      effort,
      permissionMode,
      disablePlugins,
      allowedTools,
      branchName: worktree ?? aiConfig.branchName,
      ...(systemPrompt ? { systemPrompt } : {}),
      reasoning: aiConfig.reasoning,
    },
    ...(worktree ? { worktree } : {}),
    createBranch: true,
  };
}
