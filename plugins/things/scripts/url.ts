#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

export async function buildUrl(command: string, params: Map<string, string>): Promise<string> {
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

const BOOLEAN_ATTRIBUTES = ["completed", "canceled", "reveal", "duplicate"] as const;

export function coerceBooleanAttributes(
  attributes: Record<string, string>,
): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      (BOOLEAN_ATTRIBUTES as readonly string[]).includes(key) &&
      (value === "true" || value === "false")
    ) {
      result[key] = value === "true";
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function buildJsonPayload(ids: string[], attributes: Record<string, string>): string {
  if (ids.length === 0) {
    throw new Error("At least one ID is required");
  }
  if (Object.keys(attributes).length === 0) {
    throw new Error("At least one attribute is required");
  }

  const coerced = coerceBooleanAttributes(attributes);
  const data = ids.map((id) => ({
    type: "to-do" as const,
    operation: "update" as const,
    id,
    attributes: coerced,
  }));

  return JSON.stringify(data);
}

export async function xcall(url: string): Promise<string> {
  const runner = findXcallRunner();
  if (!runner) {
    throw new Error("xcall not found — x-callback-url plugin not installed");
  }
  const proc = Bun.spawn([runner, url], { stdout: "pipe", timeout: 10_000 });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`xcall failed (exit ${code})`);
  return text.trim();
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
  const ids: string[] = [];
  const params = new Map<string, string>();
  for (const arg of argv._.params) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) continue;
    const key = arg.substring(0, eqIndex);
    const value = arg.substring(eqIndex + 1);
    if (key === "id") {
      ids.push(value);
    } else {
      params.set(key, value);
    }
  }

  const useBulkJson = command === "update" && ids.length > 1;

  if (useBulkJson) {
    const attributes: Record<string, string> = {};
    for (const [key, value] of params) {
      attributes[key] = value;
    }
    const payload = buildJsonPayload(ids, attributes);
    const jsonParams = new Map<string, string>();
    jsonParams.set("data", payload);
    if (argv.flags.callback && findXcallRunner()) {
      const url = await buildUrl("json", jsonParams);
      try {
        const result = await xcall(url);
        console.log(result);
      } catch (error) {
        console.error("xcall failed, falling back to open", error);
        await openUrl("json", jsonParams);
      }
    } else {
      await openUrl("json", jsonParams);
    }
  } else {
    const singleId = ids[0];
    if (singleId) {
      params.set("id", singleId);
    }
    if (argv.flags.callback && findXcallRunner()) {
      const url = await buildUrl(command, params);
      try {
        const result = await xcall(url);
        console.log(result);
      } catch (error) {
        console.error("xcall failed, falling back to open", error);
        await openUrl(command, params);
      }
    } else {
      await openUrl(command, params);
    }
  }
}
