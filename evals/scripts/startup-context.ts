#!/usr/bin/env bun

import { Command } from "@commander-js/extra-typings";
import type { Heading, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { toString } from "mdast-util-to-string";
import { gfmTable } from "micromark-extension-gfm-table";
import { z } from "zod";
import { expectSuccess, runCommand } from "./command";

export const PROBE_AGENTS = ["general-purpose", "analyst", "Explore", "review:review"] as const;

export interface Candidate {
  addDir: string[];
  settings?: string;
  pluginDir: string[];
}

export interface ContextReport {
  total: number;
  categories: Record<string, number>;
  memory: { type: string; path: string; tokens: number }[];
  skills: { name: string; source: string; tokens: number }[];
  mcpTools: { name: string; server: string; tokens: number }[];
  agents: { name: string; source: string; tokens: number }[];
}

// /context prints counts as "15.3k", "657", "~110", or "< 20".
export function parseTokens(text: string): number {
  const match = /([\d.]+)\s*(k?)/.exec(text);
  if (match === null) throw new Error(`Unparseable token count: ${text}`);
  const value = Number(match[1]) * (match[2] === "k" ? 1000 : 1);
  return Math.round(value);
}

function cell(row: string[], i: number): string {
  return row[i] ?? "";
}

function tableRows(table: Table): string[][] {
  return table.children.slice(1).map((row) => row.children.map((node) => toString(node).trim()));
}

export function parseContext(markdown: string): ContextReport {
  const tree = fromMarkdown(markdown, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  const tables = new Map<string, string[][]>();
  let heading = "";
  let total = 0;
  for (const node of tree.children) {
    if (node.type === "heading") heading = toString(node satisfies Heading);
    if (node.type === "table") tables.set(heading, tableRows(node));
    if (node.type === "paragraph") {
      const match = /Tokens:\s*([\d.]+k?)/.exec(toString(node));
      if (match?.[1] !== undefined) total = parseTokens(match[1]);
    }
  }
  const rows = (name: string): string[][] => tables.get(name) ?? [];
  return {
    total,
    categories: Object.fromEntries(
      rows("Estimated usage by category").map((row) => [cell(row, 0), parseTokens(cell(row, 1))]),
    ),
    memory: rows("Memory Files").map((row) => ({
      type: cell(row, 0),
      path: cell(row, 1),
      tokens: parseTokens(cell(row, 2)),
    })),
    skills: rows("Skills").map((row) => ({
      name: cell(row, 0),
      source: cell(row, 1),
      tokens: parseTokens(cell(row, 2)),
    })),
    mcpTools: rows("MCP Tools").map((row) => ({
      name: cell(row, 0),
      server: cell(row, 1),
      tokens: parseTokens(cell(row, 2)),
    })),
    agents: rows("Custom Agents").map((row) => ({
      name: cell(row, 0),
      source: cell(row, 1),
      tokens: parseTokens(cell(row, 2)),
    })),
  };
}

function candidateArgs(candidate: Candidate): string[] {
  return [
    ...candidate.addDir.flatMap((dir) => ["--add-dir", dir]),
    ...(candidate.settings === undefined ? [] : ["--settings", candidate.settings]),
    ...candidate.pluginDir.flatMap((dir) => ["--plugin-dir", dir]),
  ];
}

// Without this, --add-dir grants file access but skips the directory's CLAUDE.md,
// which is how a candidate memory file reaches the session.
const CANDIDATE_ENV = { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" };

export async function measureContext(candidate: Candidate): Promise<ContextReport> {
  const command = ["claude", "-p", "/context", "--model", "sonnet", ...candidateArgs(candidate)];
  const result = expectSuccess(command, await runCommand(command, { env: CANDIDATE_ENV }));
  return parseContext(result.stdout);
}

const Usage = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
});
const ToolUse = z.looseObject({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.looseObject({ subagent_type: z.string().optional() }),
});
const StreamLine = z.looseObject({
  type: z.string(),
  parent_tool_use_id: z.string().nullish(),
  total_cost_usd: z.number().optional(),
  message: z
    .looseObject({
      usage: Usage.optional(),
      content: z
        .array(z.looseObject({ type: z.string() }))
        .or(z.string())
        .optional(),
    })
    .optional(),
});

export interface ProbeReport {
  costUsd: number | undefined;
  main: number | undefined;
  agents: Record<string, number | undefined>;
}

// A probe's transcripts can't be relied on: a sandboxed child cannot write
// ~/.claude/projects. The stream carries every thread instead, with subagent
// messages tagged by the Agent tool call that spawned them.
export function parseProbeStream(stream: string): ProbeReport {
  const agentTypes = new Map<string, string>();
  const firstTurn = new Map<string | null, number>();
  let costUsd: number | undefined;
  for (const line of stream.split("\n")) {
    if (line.trim() === "") continue;
    const entry = StreamLine.parse(JSON.parse(line));
    if (entry.type === "result") costUsd = entry.total_cost_usd;
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      const tool = ToolUse.safeParse(block);
      if (
        tool.success &&
        tool.data.name === "Agent" &&
        tool.data.input.subagent_type !== undefined
      ) {
        agentTypes.set(tool.data.id, tool.data.input.subagent_type);
      }
    }
    const usage = entry.message?.usage;
    const thread = entry.parent_tool_use_id ?? null;
    if (usage === undefined || firstTurn.has(thread)) continue;
    firstTurn.set(
      thread,
      usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    );
  }
  const agents: Record<string, number | undefined> = {};
  for (const [toolUseId, agentType] of agentTypes) agents[agentType] = firstTurn.get(toolUseId);
  return { costUsd, main: firstTurn.get(null), agents };
}

export async function probe(candidate: Candidate): Promise<ProbeReport> {
  const prompt = `Spawn these subagents in parallel, each with the prompt 'Reply with the single word ok.' and nothing else: ${PROBE_AGENTS.join(", ")}. Then reply done.`;
  const command = [
    "claude",
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "sonnet",
    "--allowedTools",
    "Agent",
    ...candidateArgs(candidate),
  ];
  const result = expectSuccess(command, await runCommand(command, { env: CANDIDATE_ENV }));
  return parseProbeStream(result.stdout);
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function candidateCommand(name: string, description: string) {
  return new Command(name)
    .description(description)
    .option(
      "--add-dir <dir>",
      "directory whose CLAUDE.md joins the session, repeatable",
      collect,
      [],
    )
    .option("--settings <file>", "settings file layered over the user's")
    .option("--plugin-dir <dir>", "plugin loaded from a directory, repeatable", collect, []);
}

const contextCommand = candidateCommand(
  "context",
  "Free /context breakdown under the real config plus a candidate.",
).action(async (options) => {
  console.log(JSON.stringify(await measureContext(options), null, 2));
});

const probeCommand = candidateCommand(
  "probe",
  "Billed first-turn context for the main thread and each probe agent.",
).action(async (options) => {
  console.log(JSON.stringify(await probe(options), null, 2));
});

export const program = new Command("startup-context")
  .description("Measure the context a session and its subagents start with.")
  .addCommand(contextCommand)
  .addCommand(probeCommand);

if (import.meta.main) {
  await program.parseAsync();
}
