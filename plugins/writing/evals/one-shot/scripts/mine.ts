#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "@commander-js/extra-typings";
import { z } from "zod";
import { lintProse, type ValeAlert } from "../../../detection/vale";
import { getExtension, isMarkdownFile } from "../../../detection/paths";
import {
  getDataDir,
  listImportedHosts,
  sessionDbPath,
} from "../../../../observability/skills/session/scripts/db";
import { cliAdapter, runQuery } from "../../../../observability/skills/session/scripts/query";

// Drafts the writing hook sees: markdown written to disk, and bodies sent once
// through a tracker or chat tool. A draft below this length carries too little
// prose to rewrite.
export const MIN_WORDS = 40;

const MESSAGE_FIELDS: Record<string, (input: Record<string, unknown>) => unknown[]> = {
  mcp__claude_ai_Linear__save_issue: (input) => [input.description],
  mcp__claude_ai_Linear__save_comment: (input) => [input.body],
  mcp__github__create_pull_request: (input) => [input.body],
  mcp__github__update_pull_request: (input) => [input.body],
  "mcp__claude_ai_Notion__notion-create-pages": (input) =>
    Array.isArray(input.pages)
      ? input.pages.map((page: unknown) =>
          typeof page === "object" && page !== null && "content" in page ? page.content : null,
        )
      : [],
};

export const ToolUse = z.object({
  host: z.string(),
  session_id: z.string(),
  timestamp: z.string(),
  name: z.string(),
  input: z.string(),
});
export type ToolUse = z.infer<typeof ToolUse>;

export interface Payload {
  host: string;
  session: string;
  timestamp: string;
  tool: string;
  // The file a Write or Edit targets, or the tool name for a message, so a
  // session's later revisions of one draft collapse onto its first version.
  target: string;
  message: boolean;
  text: string;
}

export interface Draft extends Omit<Payload, "session" | "target"> {
  id: string;
  split: "dev" | "holdout";
  findings: ValeAlert[];
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

// Drafts staged under a tmp/ directory are PR, issue, and comment bodies on
// their way to a send, so they get the message rules.
const isStagedMessage = (path: string) => /(^|\/)tmp\//.test(path);

export function payloadsOf(use: ToolUse): Payload[] {
  const input = z.record(z.string(), z.unknown()).parse(JSON.parse(use.input));
  const payload = (target: string, message: boolean, text: string): Payload => ({
    host: use.host,
    session: use.session_id,
    timestamp: use.timestamp,
    tool: use.name,
    target,
    message,
    text,
  });
  const path = typeof input.file_path === "string" ? input.file_path : "";
  if (use.name === "Write" || use.name === "Edit") {
    if (!isMarkdownFile(getExtension(path))) return [];
    const text = use.name === "Write" ? input.content : input.new_string;
    if (typeof text !== "string") return [];
    return [payload(path, isStagedMessage(path), text)];
  }
  const fields = MESSAGE_FIELDS[use.name]?.(input) ?? [];
  return fields
    .filter((text): text is string => typeof text === "string")
    .map((text) => payload(use.name, true, text));
}

export function idOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// A stable fifth of drafts, chosen by id, stays out of tuning.
export function splitOf(id: string): Draft["split"] {
  return Number.parseInt(id.slice(0, 2), 16) % 5 === 0 ? "holdout" : "dev";
}

/** The first version of each draft, long enough to rewrite, once per text. */
export function firstDrafts(payloads: Payload[]): Payload[] {
  const seen = new Set<string>();
  const kept: Payload[] = [];
  for (const payload of payloads.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const target = `${payload.host}:${payload.session}:${payload.target}`;
    const text = idOf(payload.text);
    if (seen.has(target) || seen.has(text)) continue;
    seen.add(target);
    seen.add(text);
    if (words(payload.text) >= MIN_WORDS) kept.push(payload);
  }
  return kept;
}

/**
 * Up to `perCheck` drafts for each check, in id order, so a rare rule
 * gets drafts beside the common ones.
 */
export function sample(drafts: Draft[], perCheck: number): Draft[] {
  const counts = new Map<string, number>();
  const chosen: Draft[] = [];
  for (const draft of drafts.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const checks = new Set(draft.findings.map((finding) => finding.Check));
    if (![...checks].some((check) => (counts.get(check) ?? 0) < perCheck)) continue;
    chosen.push(draft);
    for (const check of checks) counts.set(check, (counts.get(check) ?? 0) + 1);
  }
  return chosen;
}

const sqlList = (values: string[]) => values.map((value) => `'${value}'`).join(", ");

function toolUsesSql(hosts: string[], since: string): string {
  const names = ["Write", "Edit", ...Object.keys(MESSAGE_FIELDS)];
  return `
    SELECT host, session_id, CAST(timestamp AS VARCHAR) AS timestamp, name,
      CAST(data->'$.input' AS VARCHAR) AS input
    FROM content_items
    WHERE type = 'tool_use' AND name IN (${sqlList(names)})
      AND host IN (${sqlList(hosts)}) AND timestamp >= '${since}'
      AND length(CAST(data->'$.input' AS VARCHAR)) > 200`;
}

// A host imported without --egress must not reach the bucket, so its drafts
// never enter the sample.
async function egressHosts(): Promise<string[]> {
  const imported = await listImportedHosts();
  return [
    "local",
    ...imported
      .filter(({ manifest }) => manifest.policy.block_egress === false)
      .map(({ label }) => label),
  ];
}

async function toDraft(payload: Payload): Promise<Draft> {
  const id = idOf(payload.text);
  const findings = await lintProse(payload.text, payload.message ? undefined : payload.target, {
    message: payload.message,
  });
  const { session: _session, target: _target, ...rest } = payload;
  return { ...rest, id, split: splitOf(id), findings };
}

const positive = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  if (!(parsed > 0)) throw new InvalidArgumentError("expected a positive integer");
  return parsed;
};

const program = new Command()
  .name("mine")
  .description("Collect hook-visible drafts that trip at least one writing rule.")
  .option("--since <date>", "earliest tool call to read", "2026-01-01")
  .option("--per-check <n>", "drafts kept per Vale check", positive, 15)
  .option("--out <file>", "output JSONL", join(import.meta.dirname, "..", "data", "drafts.jsonl"))
  .action(async (options) => {
    const hosts = await egressHosts();
    const uses = await runQuery(
      cliAdapter(sessionDbPath(getDataDir())),
      { sql: toolUsesSql(hosts, options.since) },
      ToolUse,
    );
    const payloads = firstDrafts(uses.flatMap(payloadsOf));
    const drafts = (await Promise.all(payloads.map(toDraft))).filter(
      (draft) => draft.findings.length > 0,
    );
    const chosen = sample(drafts, options.perCheck);
    await mkdir(join(options.out, ".."), { recursive: true });
    await Bun.write(options.out, `${chosen.map((draft) => JSON.stringify(draft)).join("\n")}\n`);
    console.error(
      `${uses.length} tool calls from ${hosts.join(", ")}, ${payloads.length} first drafts, ` +
        `${drafts.length} with findings, ${chosen.length} sampled to ${options.out}`,
    );
  });

if (import.meta.main) await program.parseAsync();
