import { resolve } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

export type { SyncHookJSONOutput };

export type WriteInput = { file_path: string; content: string };
export type EditInput = { file_path: string; new_string: string };

export function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

const MEMORY_PATH_PATTERN = /\/\.claude\/projects\/[^/]+\/memory\//;

export function isMemoryPath(filePath: string): boolean {
  return MEMORY_PATH_PATTERN.test(resolve(filePath));
}

export function isPlanPath(filePath: string): boolean {
  const home = process.env.HOME ?? "";
  return home !== "" && filePath.startsWith(`${home}/.claude/plans/`);
}

export function isMarkdownFile(ext: string): boolean {
  return ext === "md" || ext === "markdown";
}

const PROSE_EXTENSIONS = new Set(["md", "markdown", "txt", "mdx", "rst", "adoc"]);

export function isProseFile(filePath: string): boolean {
  return PROSE_EXTENSIONS.has(getExtension(filePath));
}

export function formatDecision(decision: "deny" | "ask", reason: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
}

export function formatContext(context: string): SyncHookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: context,
    },
  };
}
