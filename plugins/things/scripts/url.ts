#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to open/xcall for Things URL schemes and osascript via ensure-running, which the command sandbox blocks

import { basename, join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { ensureThingsRunning } from "./ensure-running";

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

async function getAuthToken(): Promise<string> {
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

interface OpenUrlOptions {
  background?: boolean;
}

async function buildUrl(command: string, params: Map<string, string>): Promise<string> {
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

export function isSandboxBlockedHandoff(stderr: string): boolean {
  return /procNotFound|LSOpenURLsWithRole|(?<![\d-])-10810(?!\d)|(?<![\d-])-10673(?!\d)/i.test(
    stderr,
  );
}

async function openUrl(
  command: string,
  params: Map<string, string>,
  options?: OpenUrlOptions,
): Promise<void> {
  const url = await buildUrl(command, params);
  const background = options?.background ?? (command !== "show" && command !== "search");

  try {
    if (background) {
      await $`open -g ${url}`;
    } else {
      await $`open ${url}`;
    }
  } catch (error) {
    if (error instanceof $.ShellError) {
      const stderr = error.stderr.toString();
      if (isSandboxBlockedHandoff(stderr)) {
        throw new Error(
          `Things URL handoff was blocked by the Claude Code sandbox (LaunchServices procNotFound / -10810 / -10673). Launch Services handoff requires sandbox.allowAppleEvents in user/settings.json. Original stderr: ${stderr.trim()}`,
        );
      }
    }
    throw error;
  }
}

export async function findXcallRunner(
  pluginRoot: string = join(import.meta.dirname, ".."),
): Promise<string | null> {
  // Dev layout: sibling plugin directory
  const devPath = join(pluginRoot, "..", "x-callback-url", "scripts", "run.sh");
  if (await Bun.file(devPath).exists()) return devPath;

  // Installed layout: <marketplace>/<plugin>/<version>, where the version
  // directory is the marketplace commit. Only the sibling under this plugin's
  // own version was installed from the same commit, and only its run.sh is
  // known to honor the bounds xcallBackstopMs sizes its backstop against. A
  // runner from any other version could outlive the backstop and die on a
  // signal rather than naming its own failure, so no other version qualifies.
  const installedPath = join(
    pluginRoot,
    "..",
    "..",
    "x-callback-url",
    basename(pluginRoot),
    "scripts",
    "run.sh",
  );
  return (await Bun.file(installedPath).exists()) ? installedPath : null;
}

const BOOLEAN_ATTRIBUTES = ["completed", "canceled", "reveal", "duplicate"] as const;
const ARRAY_ATTRIBUTES = ["tags", "add-tags"] as const;

interface ChecklistItem {
  type: "checklist-item";
  attributes: { title: string };
}

type CoercedValue = string | boolean | string[] | ChecklistItem[];

export function coerceAttributes(attributes: Record<string, string>): Record<string, CoercedValue> {
  const result: Record<string, CoercedValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      (BOOLEAN_ATTRIBUTES as readonly string[]).includes(key) &&
      (value === "true" || value === "false")
    ) {
      result[key] = value === "true";
    } else if ((ARRAY_ATTRIBUTES as readonly string[]).includes(key)) {
      result[key] = value.split(",").map((s) => s.trim());
    } else if (key === "checklist-items") {
      result[key] = value
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => ({ type: "checklist-item" as const, attributes: { title: line.trim() } }));
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

  const coerced = coerceAttributes(attributes);
  const data = ids.map((id) => ({
    type: "to-do" as const,
    operation: "update" as const,
    id,
    attributes: coerced,
  }));

  return JSON.stringify(data);
}

/** run.sh statuses that mean the bridge never reached the app. */
const XCALL_BUILD_FAILED = 3;
const XCALL_TIMED_OUT = 4;

/** run.sh's default for each of its two bounds, and its SIGTERM-to-SIGKILL grace. */
const XCALL_BOUND_DEFAULT_SECONDS = 20;
const XCALL_KILL_GRACE_SECONDS = 2;

/** Slack over run.sh's own bounds, covering process startup and the Swift build. */
const XCALL_BACKSTOP_MARGIN_MS = 15_000;

function boundSeconds(env: Record<string, string | undefined>, name: string): number {
  const seconds = Number(env[name]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : XCALL_BOUND_DEFAULT_SECONDS;
}

/**
 * Backstop for a runner that dies without honoring its own watchdogs. Derived
 * from run.sh's two bounds rather than fixed, because run.sh invites raising
 * either one in its own timeout message. A backstop below their sum kills the
 * runner before it can name why it failed, and the caller gets an anonymous
 * signal in place of exit 3 or 4.
 */
export function xcallBackstopMs(env: Record<string, string | undefined>): number {
  const bounds =
    boundSeconds(env, "XCALL_BUILD_TIMEOUT_SECONDS") +
    boundSeconds(env, "XCALL_TIMEOUT_SECONDS") +
    XCALL_KILL_GRACE_SECONDS;
  return bounds * 1000 + XCALL_BACKSTOP_MARGIN_MS;
}

export class XcallError extends Error {
  constructor(
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(`xcall failed (exit ${exitCode})`);
    this.name = "XcallError";
  }
}

/** Names an xcall failure in one clause, for a "no id because ..." sentence. */
export function describeXcallFailure(error: unknown): string {
  if (!(error instanceof XcallError)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.exitCode) {
    case XCALL_BUILD_FAILED:
      return "the x-callback-url bridge failed to build";
    case XCALL_TIMED_OUT:
      return "the x-callback-url bridge timed out waiting for Things to call back";
    default:
      return `xcall exited ${error.exitCode}`;
  }
}

async function xcall(runner: string, url: string): Promise<string> {
  const proc = Bun.spawn([runner, url], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: xcallBackstopMs(process.env),
  });
  const [text, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new XcallError(code, stderr);
  return text.trim();
}

function parseThingsId(xcallOutput: string): string | null {
  const match = xcallOutput.match(/x-things-id=([^&\s]+)/);
  return match?.[1] ?? null;
}

export interface DispatchResult {
  /** The created/updated todo id, when xcall returned one. */
  id: string | null;
  /** Raw xcall stdout, or null when the call fell back to Launch Services open. */
  output: string | null;
  /** Whether the call ran via xcall (true) or fell back to Launch Services open (false). */
  viaXcall: boolean;
  /** Why the call degraded to Launch Services open, or null when it did not. */
  fallbackReason: string | null;
  /** Runner stderr behind a degraded call, when it wrote any. */
  fallbackDetail: string | null;
}

/**
 * Runner and open hooks for {@link dispatch}, injectable for tests.
 * Mirrors the MergeActions pattern in plugins/gitlab/scripts/merge.ts.
 */
export interface DispatchActions {
  findXcallRunner(): Promise<string | null>;
  xcall(runner: string, url: string): Promise<string>;
  openUrl(command: string, params: Map<string, string>, options?: OpenUrlOptions): Promise<void>;
}

const defaultActions: DispatchActions = { findXcallRunner, xcall, openUrl };

/**
 * Builds the Things URL for an action, runs it through xcall when the
 * x-callback-url runner is available, and falls back to a Launch Services open
 * on any xcall failure. Returns the parsed todo id when xcall surfaced one, and
 * a fallbackReason when it did not, so the caller can say the write landed
 * without an id instead of degrading silently.
 */
export async function dispatch(
  command: string,
  params: Map<string, string>,
  actions: DispatchActions = defaultActions,
): Promise<DispatchResult> {
  const runner = await actions.findXcallRunner();
  let fallbackReason = "the x-callback-url runner was not found";
  let fallbackDetail: string | null = null;

  if (runner) {
    const url = await buildUrl(command, params);
    try {
      const result = await actions.xcall(runner, url);
      return {
        id: parseThingsId(result),
        output: result,
        viaXcall: true,
        fallbackReason: null,
        fallbackDetail: null,
      };
    } catch (error) {
      fallbackReason = describeXcallFailure(error);
      fallbackDetail = error instanceof XcallError ? error.stderr.trim() || null : null;
    }
  }

  await actions.openUrl(command, params);
  return { id: null, output: null, viaXcall: false, fallbackReason, fallbackDetail };
}

/**
 * Reports a degraded dispatch on stderr. The write still landed through Launch
 * Services, so this is a warning rather than a failure.
 */
export function warnFallback(result: DispatchResult): void {
  if (result.fallbackReason === null) return;
  console.error(
    `warning: no todo id available because ${result.fallbackReason}. The change was sent fire-and-forget via open.`,
  );
  if (result.fallbackDetail) console.error(result.fallbackDetail);
}

if (import.meta.main) {
  await ensureThingsRunning();

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

  const callbackActions: DispatchActions = argv.flags.callback
    ? defaultActions
    : { ...defaultActions, findXcallRunner: async () => null };

  if (useBulkJson) {
    const attributes: Record<string, string> = {};
    for (const [key, value] of params) {
      attributes[key] = value;
    }
    const payload = buildJsonPayload(ids, attributes);
    const jsonParams = new Map<string, string>();
    jsonParams.set("data", payload);
    const result = await dispatch("json", jsonParams, callbackActions);
    if (result.output !== null) {
      console.log(result.output);
    }
    if (argv.flags.callback) warnFallback(result);
  } else {
    const singleId = ids[0];
    if (singleId) {
      params.set("id", singleId);
    }
    const result = await dispatch(command, params, callbackActions);
    if (result.output !== null) {
      console.log(result.output);
    }
    if (argv.flags.callback) warnFallback(result);
  }
}
