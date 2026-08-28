#!/usr/bin/env bun

import type {
  PostToolUseFailureHookInput,
  SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { $ } from "bun";
import { BashInput, PostToolUseFailure } from "./hook-input";

/**
 * Secretive gates every signature behind Touch ID, so an unattended `ssh` gets
 * `agent refused operation` instead of a signature. A key that never reached the
 * agent produces the plain publickey denial, which HTTPS also resolves.
 */
const SSH_AUTH_SIGNATURES = [
  "agent refused operation",
  "Permission denied (publickey)",
  "sign_and_send_pubkey: signing failed",
];

const NETWORK_SUBCOMMANDS = new Set([
  "clone",
  "fetch",
  "ls-remote",
  "pull",
  "push",
  "remote",
  "submodule",
]);

/** `git` options that consume the following argument, so it is not the subcommand. */
const VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);

export interface Provider {
  host: string;
  cli: string;
  patterns: RegExp[];
}

function provider(host: string, cli: string): Provider {
  const escaped = host.replaceAll(".", String.raw`\.`);
  return {
    host,
    cli,
    patterns: [
      new RegExp(String.raw`\bgit@${escaped}:`),
      new RegExp(String.raw`\bssh://git@${escaped}[:/]`),
    ],
  };
}

/**
 * Hosts whose CLI holds credentials that grant HTTPS push access. A host absent
 * here (self-hosted forges, enterprise domains) has no known credential helper,
 * so the hook stays silent rather than suggest a retry that cannot authenticate.
 */
const PROVIDERS = [provider("github.com", "gh"), provider("gitlab.com", "glab")];

function httpsConfig({ host, cli }: Provider): string {
  return [
    "-c credential.helper=",
    `-c 'credential.helper=!${cli} auth git-credential'`,
    `-c 'url.https://${host}/.insteadOf=git@${host}:'`,
    `-c 'url.https://${host}/.insteadOf=ssh://git@${host}/'`,
  ].join(" ");
}

export function hasSshAuthFailure(output: string): boolean {
  return SSH_AUTH_SIGNATURES.some((signature) => output.includes(signature));
}

/** Returns the provider whose SSH remote form appears in the text, or null. */
export function sshProviderOf(text: string): Provider | null {
  return PROVIDERS.find((p) => p.patterns.some((pattern) => pattern.test(text))) ?? null;
}

const GIT_INVOCATION = /(?:^|[;&|]\s*|\s)git(?=\s)/g;
const SEGMENT_SEPARATOR = /(?:&&|\|\||[;|\n])/;

/** Resolves the subcommand of one `git` invocation, skipping git's own options. */
function subcommandOf(args: string[]): string | null {
  let skipValue = false;
  for (const token of args) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (VALUE_OPTIONS.has(token)) {
      skipValue = true;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return null;
}

/**
 * Locates the `git` invocation in a shell line that performs a network operation,
 * returning its subcommand and the offset just past the `git` token. Detection and
 * rewriting share this so a line like `git status && git push` rewrites the push.
 */
function findNetworkInvocation(command: string): { subcommand: string; insertAt: number } | null {
  for (const match of command.matchAll(GIT_INVOCATION)) {
    const insertAt = match.index + match[0].length;
    const [segment = ""] = command.slice(insertAt).split(SEGMENT_SEPARATOR);
    const subcommand = subcommandOf(segment.trim().split(/\s+/).filter(Boolean));
    if (subcommand && NETWORK_SUBCOMMANDS.has(subcommand)) return { subcommand, insertAt };
  }
  return null;
}

/** Returns the git network subcommand a shell line invokes, or null. */
export function gitNetworkSubcommand(command: string): string | null {
  return findNetworkInvocation(command)?.subcommand ?? null;
}

/**
 * Inserts the HTTPS config into the failing `git` invocation. Rewriting the URL
 * through `insteadOf` keeps the remote name, refspecs, and remote-tracking ref
 * updates identical to the SSH attempt.
 */
export function rewriteCommand(command: string, target: Provider): string | null {
  const invocation = findNetworkInvocation(command);
  if (!invocation) return null;

  const { insertAt } = invocation;
  return `${command.slice(0, insertAt)} ${httpsConfig(target)}${command.slice(insertAt)}`;
}

export function formatContext(retryCommand: string, cli: string): string {
  return [
    "The SSH agent refused to sign, so this git operation could not authenticate over SSH.",
    `Retry the exact same operation over HTTPS, which authenticates through ${cli}'s credential helper:`,
    "",
    retryCommand,
    "",
    "The url.insteadOf rewrite keeps the remote name and refspecs, so remote-tracking refs update as they would have over SSH. Do not change the repository's configured remote URLs.",
  ].join("\n");
}

/** Reads the repo's remote URLs so a bare `git pull` still resolves to a provider's SSH remote. */
export async function readRemoteUrls(cwd: string): Promise<string> {
  // Interpolated so Bun's shell escapes the pattern instead of glob-expanding it.
  const pattern = String.raw`^remote\..*\.url$`;
  const result = await $`git config --get-regexp ${pattern}`.cwd(cwd).quiet().nothrow();
  return result.exitCode === 0 ? result.text() : "";
}

export async function processInput(
  input: PostToolUseFailureHookInput,
  readRemotes: (cwd: string) => Promise<string> = readRemoteUrls,
): Promise<SyncHookJSONOutput | null> {
  const command = BashInput.safeParse(input.tool_input).data?.command;
  if (!command) return null;

  if (!gitNetworkSubcommand(command)) return null;
  if (!hasSshAuthFailure(input.error ?? "")) return null;

  const cwd = input.cwd ?? process.cwd();
  const target = sshProviderOf(command) ?? sshProviderOf(await readRemotes(cwd));
  if (!target) return null;

  const retryCommand = rewriteCommand(command, target);
  if (!retryCommand) return null;

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: formatContext(retryCommand, target.cli),
    },
  };
}

async function main(): Promise<void> {
  let input: PostToolUseFailureHookInput;
  try {
    input = PostToolUseFailure.parse(JSON.parse(await Bun.stdin.text()));
  } catch {
    return;
  }

  if (input.hook_event_name !== "PostToolUseFailure") return;

  const output = await processInput(input);
  if (output) {
    process.stdout.write(`${JSON.stringify(output)}\n`);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
