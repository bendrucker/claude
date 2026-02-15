#!/usr/bin/env bun

import { hostname } from "node:os";
import type {
  NotificationHookInput,
  PermissionRequestHookInput,
  StopHookInput,
  TaskCompletedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { readStdinJson } from "@constellos/claude-code-kit/runners";

type HookInput =
  | NotificationHookInput
  | StopHookInput
  | PermissionRequestHookInput
  | TaskCompletedHookInput;

type Env = Record<string, string | undefined>;

export function shouldNotify(env: Env): boolean {
  return !!(env.SSH_CONNECTION && env.NTFY_URL && env.NTFY_TOKEN);
}

export function sessionContext(env: Env): string {
  return env.CLAUDE_TMUX_SESSION || hostname();
}

export function buildTitle(context: string, title: string): string {
  return `[${context}] ${title}`;
}

export function mapPriority(input: HookInput): string {
  switch (input.hook_event_name) {
    case "PermissionRequest":
      return "high";
    case "Stop":
      return "low";
    default:
      return "default";
  }
}

export function buildRequest(
  input: HookInput,
  env: Env,
): { url: string; title: string; body: string; priority: string } {
  const url = env.NTFY_URL as string;
  const context = sessionContext(env);
  const priority = mapPriority(input);

  switch (input.hook_event_name) {
    case "Notification":
      return {
        url,
        title: buildTitle(context, input.title || "Claude Code"),
        body: input.message,
        priority,
      };

    case "Stop":
      return {
        url,
        title: buildTitle(context, "Claude Code stopped"),
        body: input.stop_hook_active ? "Session ended (stop hook active)" : "Session ended",
        priority,
      };

    case "PermissionRequest":
      return {
        url,
        title: buildTitle(context, `Permission needed: ${input.tool_name}`),
        body: formatToolInput(input.tool_name, input.tool_input),
        priority,
      };

    case "TaskCompleted":
      return {
        url,
        title: buildTitle(context, "Task completed"),
        body: input.task_subject,
        priority,
      };
  }
}

function formatToolInput(toolName: string, toolInput: unknown): string {
  if (toolName === "Bash" && typeof toolInput === "object" && toolInput !== null) {
    const command = (toolInput as Record<string, unknown>).command;
    if (typeof command === "string") return command;
  }
  return `${toolName} tool call`;
}

async function main(): Promise<void> {
  if (!shouldNotify(process.env)) return;

  let input: HookInput;
  try {
    input = await readStdinJson<HookInput>();
  } catch {
    return;
  }

  const req = buildRequest(input, process.env);

  fetch(req.url, {
    method: "POST",
    body: req.body,
    headers: {
      Authorization: `Bearer ${process.env.NTFY_TOKEN}`,
      Title: req.title,
      Priority: req.priority,
    },
  }).catch(() => {});
}

if (import.meta.main) {
  main().catch(() => {});
}
