#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: hands off to open/xcall for Things URL schemes and osascript via ensure-running, which the command sandbox blocks

import { join } from "node:path";
import { $ } from "bun";
import { cli } from "cleye";
import { findSiblingScript } from "../src/marketplace";
import { requireTags, type TagRequirer } from "../src/mcp/tags";
import { ensureThingsRunning } from "./ensure-running";
import { parseTags } from "./tags";

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
    // Bun's `$` inherits stdout, which is the MCP server's JSON-RPC channel, so
    // anything Launch Services prints there corrupts the protocol. Capture it
    // and forward it to stderr, where both the CLI and tailgate's logs read it.
    const result = background ? await $`open -g ${url}`.quiet() : await $`open ${url}`.quiet();
    const output = result.stdout.toString() + result.stderr.toString();
    if (output !== "") process.stderr.write(output);
  } catch (error) {
    if (error instanceof $.ShellError) {
      const stderr = error.stderr.toString();
      if (isSandboxBlockedHandoff(stderr)) {
        throw new Error(
          `Things URL handoff was blocked by the Claude Code sandbox (LaunchServices procNotFound / -10810 / -10673). Launch Services handoff requires sandbox.allowAppleEvents in user/settings.json. Original stderr: ${stderr.trim()}`,
          { cause: error },
        );
      }
      // ShellError's own message is only the exit code, and `.quiet()` holds
      // what `open` printed, so the diagnostic reaches a caller only if the
      // message carries it.
      const stderrDetail = stderr.trim();
      const detail = stderrDetail !== "" ? stderrDetail : error.stdout.toString().trim();
      throw new Error(
        `Things URL handoff failed (open exited ${error.exitCode})${detail !== "" ? `: ${detail}` : ""}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * The version match matters here because only the same-commit `run.sh` is known
 * to honor the bounds `xcallBackstopMs` sizes its backstop against. A runner
 * from another version could outlive the backstop and die on a signal rather
 * than naming its own failure.
 */
export function findXcallRunner(
  pluginRoot: string = join(import.meta.dirname, ".."),
): Promise<string | null> {
  return findSiblingScript(pluginRoot, "x-callback-url", "scripts", "run.sh");
}

const BOOLEAN_ATTRIBUTES = ["completed", "canceled", "reveal", "duplicate"] as const;

/**
 * The params a write carries tags in. They are also the only array-valued
 * attributes the JSON payload coerces, so `ARRAY_ATTRIBUTES` reads from here.
 */
const TAG_PARAMS = ["tags", "add-tags"] as const;
const ARRAY_ATTRIBUTES = TAG_PARAMS;

/**
 * Resolves a CLI write's tag params against the tags Things holds, so the raw
 * dispatcher rejects an unknown tag the way the MCP tools and `inbox.ts` do.
 * Things drops a tag it does not know and reports success anyway, so a write
 * that skips this lands with the tag missing and nothing said about it.
 *
 * Mutates `params` in place. A command carrying no tags is left alone and never
 * pays for the tag fetch, and an empty `tags=` is passed through untouched
 * because Things reads it as clearing the todo's tags.
 */
export async function resolveTagParams(
  params: Map<string, string>,
  createMissing: boolean,
  requirer: TagRequirer = requireTags,
): Promise<void> {
  for (const key of TAG_PARAMS) {
    const requested = parseTags(params.get(key));
    if (requested.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- the requirer caches the tag list across calls and creates the missing ones.
    params.set(key, (await requirer(requested, createMissing)).join(","));
  }
}

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
        .filter((line) => line.trim() !== "")
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

function boundSeconds(
  env: Record<string, string | undefined>,
  name: string,
  fallback = XCALL_BOUND_DEFAULT_SECONDS,
): number {
  const seconds = Number(env[name]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
}

/**
 * Backstop for a runner that dies without honoring its own watchdogs. Derived
 * from run.sh's bounds rather than fixed, because run.sh invites raising them
 * in its own timeout messages. A backstop below their sum kills the runner
 * before it can name why it failed, and the caller gets an anonymous signal in
 * place of exit 3, 4, or 5.
 *
 * The callback timeout counts twice. run.sh serializes on a lock first, and a
 * caller that finds the bridge busy waits out the holder's full turn before
 * starting its own. XCALL_LOCK_WAIT_SECONDS overrides that wait, so the
 * backstop reads it rather than assuming the derivation it defaults to.
 */
export function xcallBackstopMs(env: Record<string, string | undefined>): number {
  const callback = boundSeconds(env, "XCALL_TIMEOUT_SECONDS");
  const lockWait = boundSeconds(
    env,
    "XCALL_LOCK_WAIT_SECONDS",
    callback + XCALL_KILL_GRACE_SECONDS + 1,
  );
  const bounds =
    boundSeconds(env, "XCALL_BUILD_TIMEOUT_SECONDS") +
    lockWait +
    callback +
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

  if (runner != null && runner !== "") {
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
      const detail = error instanceof XcallError ? error.stderr.trim() : "";
      fallbackDetail = detail !== "" ? detail : null;
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
  if (result.fallbackDetail != null && result.fallbackDetail !== "")
    console.error(result.fallbackDetail);
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
      createTags: {
        type: Boolean,
        default: false,
        description: "Create any tag that does not exist yet. Without it, an unknown tag fails",
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

  // Resolved before either branch, so the bulk payload built from these same
  // params carries the stored casing too. A raw `json data=...` payload is not
  // reached: that one is the escape hatch, and its tags go through unchecked.
  try {
    await resolveTagParams(params, argv.flags.createTags);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const useBulkJson = command === "update" && ids.length > 1;

  const callbackActions: DispatchActions = argv.flags.callback
    ? defaultActions
    : { ...defaultActions, findXcallRunner: () => Promise.resolve(null) };

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
    const singleId = ids.at(0);
    if (singleId !== undefined) {
      params.set("id", singleId);
    }
    const result = await dispatch(command, params, callbackActions);
    if (result.output !== null) {
      console.log(result.output);
    }
    if (argv.flags.callback) warnFallback(result);
  }
}
