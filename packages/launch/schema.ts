export const schema = {
  type: "object",
  properties: {
    model: {
      type: "string",
      enum: ["sonnet", "opus", "haiku"],
      description: "Which Claude model to use",
    },
    effort: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Effort level for the session",
    },
    disablePlugins: {
      type: "array",
      items: { type: "string" },
      description:
        "Plugin identifiers to disable (e.g. 'gitlab@bendrucker'). Only list plugins that should be disabled.",
    },
    allowedTools: {
      type: "array",
      items: { type: "string" },
      description: "Tool patterns to pre-approve (e.g. 'Bash(git:*)', 'Bash(go:*)')",
    },
    permissionMode: {
      type: "string",
      enum: ["default", "plan"],
      description: "Permission mode for the session",
    },
    branchName: {
      type: "string",
      description:
        "Suggested git branch name for the task (e.g. 'fix/auth-tests', 'feat/api-endpoint'). Use conventional prefixes: fix/, feat/, refactor/, chore/.",
    },
    systemPrompt: {
      type: "string",
      description: "Optional task-specific system prompt to append",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation of configuration choices",
    },
  },
  required: [
    "model",
    "effort",
    "disablePlugins",
    "allowedTools",
    "permissionMode",
    "branchName",
    "reasoning",
  ],
  additionalProperties: false,
} as const;

export type LaunchConfig = {
  model: "sonnet" | "opus" | "haiku";
  effort: "low" | "medium" | "high";
  disablePlugins: string[];
  allowedTools: string[];
  permissionMode: "default" | "plan";
  branchName: string;
  systemPrompt?: string;
  reasoning: string;
};
