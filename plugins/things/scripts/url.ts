#!/usr/bin/env bun

import { $ } from "bun";

const AUTH_REQUIRED_COMMANDS = ["update", "update-project", "json"] as const;

const VALID_COMMANDS = [
  "add",
  "add-project",
  "update",
  "update-project",
  "show",
  "search",
  "json",
  "version",
] as const;

type Command = (typeof VALID_COMMANDS)[number];

function isValidCommand(command: string): command is Command {
  return (VALID_COMMANDS as readonly string[]).includes(command);
}

function requiresAuth(command: string): boolean {
  return (AUTH_REQUIRED_COMMANDS as readonly string[]).includes(command);
}

export async function getAuthToken(): Promise<string> {
  try {
    const result =
      await $`security find-generic-password -a "$USER" -s "things-auth-token" -w`.text();
    return result.trim();
  } catch {
    throw new Error(
      "Things auth token not found in keychain. See 1password.md for setup instructions.",
    );
  }
}

export interface OpenUrlOptions {
  background?: boolean;
}

export async function openUrl(
  command: string,
  params: Map<string, string>,
  options?: OpenUrlOptions,
): Promise<void> {
  if (!isValidCommand(command)) {
    throw new Error(`Invalid command: ${command}`);
  }

  const parts: string[] = [];

  if (requiresAuth(command)) {
    const authToken = await getAuthToken();
    parts.push(`auth-token=${encodeURIComponent(authToken)}`);
  }

  for (const [key, value] of params) {
    parts.push(`${key}=${encodeURIComponent(value)}`);
  }

  let url = `things:///${command}`;
  if (parts.length > 0) {
    url += `?${parts.join("&")}`;
  }

  const background = options?.background ?? (command !== "show" && command !== "search");

  if (background) {
    await $`open -g ${url}`;
  } else {
    await $`open ${url}`;
  }
}

function parseArgs(argv: string[]): { command: string; params: Map<string, string> } {
  const command = argv[0];
  if (!command) {
    console.error("Usage: bun scripts/url.ts <command> [key=value ...]");
    console.error("Commands: add, add-project, update, update-project, show, search, json");
    process.exit(1);
  }

  const params = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;
    params.set(arg.substring(0, eqIndex), arg.substring(eqIndex + 1));
  }

  return { command, params };
}

if (import.meta.main) {
  const { command, params } = parseArgs(process.argv.slice(2));
  await openUrl(command, params);
}
