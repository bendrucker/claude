#!/usr/bin/env bun

import { existsSync, readdirSync } from "fs";
import { join } from "path";
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

export async function buildUrl(
  command: string,
  params: Map<string, string>,
): Promise<string> {
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

  return url;
}

export async function openUrl(
  command: string,
  params: Map<string, string>,
  options?: OpenUrlOptions,
): Promise<void> {
  const url = await buildUrl(command, params);
  const background = options?.background ?? (command !== "show" && command !== "search");

  if (background) {
    await $`open -g ${url}`;
  } else {
    await $`open ${url}`;
  }
}

export function findXcallRunner(): string | null {
  const pluginRoot = join(import.meta.dirname, "..");

  // Dev layout: sibling plugin directory
  const devPath = join(pluginRoot, "..", "x-callback-url", "scripts", "run.sh");
  if (existsSync(devPath)) return devPath;

  // Prod layout: up 2 levels to marketplace root, then into x-callback-url/<version>/
  const marketplaceDir = join(pluginRoot, "..", "..", "x-callback-url");
  if (existsSync(marketplaceDir)) {
    for (const entry of readdirSync(marketplaceDir)) {
      const candidate = join(marketplaceDir, entry, "scripts", "run.sh");
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

export async function xcall(url: string): Promise<string> {
  const runner = findXcallRunner();
  if (!runner) {
    throw new Error("xcall not found — x-callback-url plugin not installed");
  }
  return (await $`${runner} ${url}`.text()).trim();
}

if (import.meta.main) {
  const { cli } = await import("cleye");

  const argv = cli({
    name: "url",
    parameters: ["<command>", "[params...]"],
    flags: {
      callback: {
        type: Boolean,
        default: true,
        description: "Use xcall to get response from Things (disable with --callback=false)",
      },
    },
  });

  const command = argv._.command;
  const params = new Map<string, string>();
  for (const arg of argv._.params) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;
    params.set(arg.substring(0, eqIndex), arg.substring(eqIndex + 1));
  }

  if (argv.flags.callback && findXcallRunner()) {
    const url = await buildUrl(command, params);
    try {
      const result = await xcall(url);
      console.log(result);
    } catch {
      await openUrl(command, params);
    }
  } else {
    await openUrl(command, params);
  }
}
