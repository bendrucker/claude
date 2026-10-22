#!/usr/bin/env bun
// Lists every PR command a session ran, how `validate-body` resolves its body, and what the call
// returned. Reads eval traces (a results directory, or its traces/) and Claude Code transcripts
// alike, since both are JSONL of assistant tool_use and user tool_result entries.
//
//   bun report.ts results/<run> [~/.claude/projects/<project>/<session>.jsonl ...]

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { extractBodySpec, prVerb } from "../../scripts/resolve-body";
import { literal, parseShell } from "../../scripts/shell";

export interface Row {
  trace: string;
  verb: string;
  /** Commands the call runs ahead of the PR verb, as in `cp && sed`. */
  before: string;
  source: string;
  outcome: string;
}

const Block = z.looseObject({
  type: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.looseObject({ command: z.unknown() }).optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
});
type Block = z.infer<typeof Block>;

const Entry = z.looseObject({
  message: z.looseObject({ content: z.unknown() }).optional(),
});

function blocks(line: string): Block[] {
  if (line.trim() === "") return [];
  let entry: z.infer<typeof Entry> | undefined;
  try {
    entry = Entry.safeParse(JSON.parse(line)).data;
  } catch (error) {
    // A live transcript's last line can be cut mid-write, and it holds no finished tool call.
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  return z.array(Block).safeParse(entry?.message?.content).data ?? [];
}

const TextPart = z.looseObject({ text: z.string().optional() });

function text(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = z.array(TextPart).safeParse(content).data ?? [];
  return parts.map((part) => part.text ?? "").join("\n");
}

/** Where the hook takes the body from, before any file is read. */
export function bodySource(command: string): string {
  const spec = extractBodySpec(command);
  if (spec.kind === "none") return "none";
  if (spec.kind === "unreadable") return `unreadable: ${spec.detail}`;
  return spec.parts
    .map((part) => {
      if (part.kind !== "file") return part.kind;
      const name = part.writer?.split(" ")[0];
      return name === undefined ? `file ${part.path}` : `file ${part.path} after ${name}`;
    })
    .join(" + ");
}

function before(command: string, verb: string): string {
  const names: string[] = [];
  for (const step of parseShell(command)) {
    if (step.argv.slice(0, 3).map(literal).join(" ") === verb) break;
    names.push(literal(step.argv[0]) ?? "?");
  }
  return names.join(" && ");
}

export function outcome(result: Block | undefined): string {
  if (result === undefined) return "no result";
  const body = text(result.content);
  const reason = body.match(/^- (.*)$/m)?.[1];
  if (body.includes("Fix the PR body") && reason !== undefined)
    return `denied: ${reason.slice(0, 100)}`;
  if (result.is_error === true) return `error: ${body.split("\n")[0]?.slice(0, 100) ?? ""}`;
  return "ran";
}

const cells = (row: Row) => [row.trace, row.verb, row.before, row.source, row.outcome];

export function rows(trace: string, name: string): Row[] {
  const uses = new Map<string, string>();
  const results = new Map<string, Block>();
  for (const line of trace.split("\n")) {
    for (const block of blocks(line)) {
      if (
        block.type === "tool_use" &&
        block.name === "Bash" &&
        typeof block.input?.command === "string"
      ) {
        uses.set(block.id ?? "", block.input.command);
      }
      if (block.type === "tool_result") results.set(block.tool_use_id ?? "", block);
    }
  }
  const found: Row[] = [];
  for (const [id, command] of uses) {
    const verb = prVerb(command);
    if (verb === null) continue;
    found.push({
      trace: name,
      verb,
      before: before(command, verb),
      source: bodySource(command),
      outcome: outcome(results.get(id)),
    });
  }
  return found;
}

async function traceFiles(path: string): Promise<string[]> {
  if (path.endsWith(".jsonl")) return [path];
  const dir = basename(path) === "traces" ? path : join(path, "traces");
  const names = await readdir(dir);
  return names.filter((name) => name.endsWith(".jsonl")).map((name) => join(dir, name));
}

if (import.meta.main) {
  const paths = (await Promise.all(process.argv.slice(2).map(traceFiles))).flat().toSorted();
  const all: Row[] = [];
  for (const path of paths) {
    // oxlint-disable-next-line no-await-in-loop -- traces are small and the order is the output's.
    all.push(...rows(await Bun.file(path).text(), basename(path, ".jsonl")));
  }
  console.log(
    "| trace | verb | runs first | body source | outcome |\n| --- | --- | --- | --- | --- |",
  );
  for (const row of all)
    console.log(
      `| ${cells(row)
        .map((cell) => cell.replaceAll("|", String.raw`\|`))
        .join(" | ")} |`,
    );
}
