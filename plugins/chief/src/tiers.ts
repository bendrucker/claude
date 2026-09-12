import type { Tier } from "./types";

export const DESTRUCTIVE_COMMANDS = [
  "git push --force",
  "rm -rf",
  "gh pr merge",
  "launchctl bootout",
];

export const CREDENTIAL_PATTERN = /login|credential|token expired|authenticate/i;

export type Kind =
  | "credential"
  | "destructive"
  | "permission_prompt"
  | "ask_user"
  | "idle"
  | "stop"
  | "dispatch";

export type ReleaseRule = "immediate" | "grace-permission" | "boundary" | "digest";

export type Event =
  | { hook: "Notification"; notificationType: string; message: string }
  | { hook: "PermissionRequest"; toolName: string; toolInput: unknown }
  | { hook: "PostToolUse"; toolName: string }
  | { hook: "Stop" }
  | { hook: "dispatch" };

export interface TierResult {
  kind: Kind;
  tier: Tier;
  releaseAt: ReleaseRule;
  reason: string;
}

function commandOf(toolInput: unknown): string {
  if (typeof toolInput !== "object" || toolInput === null || !("command" in toolInput)) return "";
  const { command } = toolInput as { command: unknown };
  return typeof command === "string" ? command : "";
}

function isDestructive(toolName: string, toolInput: unknown): boolean {
  if (toolName !== "Bash") return false;
  const command = commandOf(toolInput);
  return DESTRUCTIVE_COMMANDS.some((pattern) => command.includes(pattern));
}

const TABLE: Record<Kind, Omit<TierResult, "kind">> = {
  credential: { tier: "now", releaseAt: "immediate", reason: "credential Notification message" },
  destructive: {
    tier: "now",
    releaseAt: "immediate",
    reason: "destructive tool permission request",
  },
  permission_prompt: {
    tier: "boundary",
    releaseAt: "grace-permission",
    reason: "permission_prompt notification",
  },
  ask_user: { tier: "boundary", releaseAt: "boundary", reason: "AskUserQuestion tool call" },
  idle: { tier: "digest", releaseAt: "digest", reason: "idle_prompt notification" },
  stop: { tier: "digest", releaseAt: "digest", reason: "session Stop" },
  dispatch: { tier: "boundary", releaseAt: "immediate", reason: "dispatch request" },
};

function result(kind: Kind): TierResult {
  return { kind, ...TABLE[kind] };
}

export function tier(event: Event): TierResult | null {
  switch (event.hook) {
    case "Notification":
      if (CREDENTIAL_PATTERN.test(event.message)) return result("credential");
      if (event.notificationType === "permission_prompt") return result("permission_prompt");
      if (event.notificationType === "idle_prompt") return result("idle");
      return null;
    case "PermissionRequest":
      return isDestructive(event.toolName, event.toolInput) ? result("destructive") : null;
    case "PostToolUse":
      return event.toolName === "AskUserQuestion" ? result("ask_user") : null;
    case "Stop":
      return result("stop");
    case "dispatch":
      return result("dispatch");
  }
}
