#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Command, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { z } from "zod";
import { decode, decodeFile, decodeJson } from "../../../../../packages/decode/index";
import { tokenize } from "../label/align";
import { mapPool } from "./pool";
import { Judgment, Pair, Pick } from "./pairs";

export interface WordDistance {
  words: number;
  deleted: number;
  inserted: number;
  /** Deleted plus inserted words, over the words in `from`. */
  distance: number;
}

/** Word-level edit distance from `from` to `to`, by a longest common subsequence over words. */
export function wordDistance(from: string, to: string): WordDistance {
  const a = tokenize(from).map((t) => t.key);
  const b = tokenize(to).map((t) => t.key);
  let prev = new Int32Array(b.length + 1);
  for (const word of a) {
    const row = new Int32Array(b.length + 1);
    for (const [j, other] of b.entries()) {
      row[j + 1] = word === other ? (prev[j] ?? 0) + 1 : Math.max(prev[j + 1] ?? 0, row[j] ?? 0);
    }
    prev = row;
  }
  const common = prev[b.length] ?? 0;
  const deleted = a.length - common;
  const inserted = b.length - common;
  const distance = a.length === 0 ? Math.min(inserted, 1) : (deleted + inserted) / a.length;
  return { words: a.length, deleted, inserted, distance };
}

export const Edit = z.object({ find: z.string(), replace: z.string() });
export type Edit = z.infer<typeof Edit>;

export type EditCall = (prompt: string) => Promise<Edit[]>;

/** Applies, in order, each edit whose `find` occurs exactly once in the running text. */
export function applyEdits(
  text: string,
  edits: readonly Edit[],
): { text: string; applied: number } {
  let current = text;
  let applied = 0;
  for (const edit of edits) {
    const at = current.indexOf(edit.find);
    if (edit.find === "" || at === -1 || current.includes(edit.find, at + 1)) continue;
    current = current.slice(0, at) + edit.replace + current.slice(at + edit.find.length);
    applied++;
  }
  return { text: current, applied };
}

/**
 * Redlines `draft` pass after pass until a pass leaves the text unchanged or `maxPasses` passes have run.
 * Returns the text after each pass that changed it.
 */
export async function settleEdits(
  draft: string,
  render: (text: string) => string,
  call: EditCall,
  maxPasses: number,
): Promise<{ passes: string[]; exhausted: boolean }> {
  interface Settled {
    passes: string[];
    exhausted: boolean;
  }
  const pass = async (text: string, remaining: number): Promise<Settled> => {
    if (remaining === 0) return { passes: [], exhausted: false };
    const { text: next, applied } = applyEdits(text, await call(render(text)));
    if (applied === 0) return { passes: [], exhausted: true };
    const rest = await pass(next, remaining - 1);
    return { passes: [next, ...rest.passes], exhausted: rest.exhausted };
  };
  return pass(draft, maxPasses);
}

export const Redline = z.object({
  key: z.string(),
  prompt: z.string(),
  model: z.string(),
  passes: z.array(z.string()),
  exhausted: z.boolean(),
  /** Words deleted plus words inserted between the draft and its settled text. */
  edits: z.number(),
  distance: z.number(),
});
export type Redline = z.infer<typeof Redline>;

export function renderEditorPrompt(
  template: string,
  surface: string,
  brief: string,
  draft: string,
): string {
  return template
    .replaceAll("{{surface}}", surface)
    .replaceAll("{{brief}}", brief)
    .replaceAll("{{draft}}", draft);
}

/** The draft needing less editing wins. Distances within `margin` of each other tie. */
export function pickByDistance(a: number, b: number, margin: number): Pick {
  if (Math.abs(a - b) <= margin) return "tie";
  return a < b ? "a" : "b";
}

const EditReply = z.object({ edits: z.array(Edit) });

function callEditor(model: string): EditCall {
  return async (prompt) => {
    for await (const message of query({
      prompt,
      options: {
        model,
        // Structured output lands through a tool call, plus a retry turn when the schema rejects it.
        maxTurns: 5,
        tools: [],
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        outputFormat: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              edits: {
                type: "array",
                items: {
                  type: "object",
                  properties: { find: { type: "string" }, replace: { type: "string" } },
                  required: ["find", "replace"],
                  additionalProperties: false,
                },
              },
            },
            required: ["edits"],
            additionalProperties: false,
          },
        },
      },
    })) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success") throw new Error(`editor call failed: ${message.subtype}`);
      const reply =
        message.structured_output !== undefined
          ? decode(EditReply, message.structured_output, "editor reply")
          : decodeJson(EditReply, message.result, "editor reply");
      return reply.edits;
    }
    throw new Error("editor call produced no result message");
  };
}

function hash(...parts: string[]): string {
  const h = createHash("sha256");
  for (const part of parts) h.update(part).update("\0");
  return h.digest("hex").slice(0, 16);
}

interface JudgeFlags {
  pairs?: string;
  out?: string;
  cache?: string;
  model: string;
  prompt: string;
  maxPasses: number;
  margin: number;
  metric: "edits" | "distance";
  concurrency: number;
  replicate: number;
}

async function judgeMain(flags: JudgeFlags): Promise<void> {
  const { pairs: pairsDir, out, cache } = flags;
  if (pairsDir === undefined || out === undefined || cache === undefined) {
    throw new Error("--pairs, --out, and --cache are required");
  }
  const template = await Bun.file(flags.prompt).text();
  const promptHash = hash(template, String(flags.maxPasses)).slice(0, 12);
  const pairs = await Promise.all(
    globSync("*.json", { cwd: pairsDir })
      .toSorted()
      .map((f) => decodeFile(Pair, join(pairsDir, f))),
  );
  await Promise.all([mkdir(out, { recursive: true }), mkdir(cache, { recursive: true })]);

  const drafts = new Map<string, { surface: string; brief: string; text: string }>();
  const salt = flags.replicate === 0 ? [] : [`replicate ${flags.replicate}`];
  const keyOf = (pair: Pair, text: string) =>
    hash(promptHash, flags.model, pair.surface, pair.brief, text, ...salt);
  for (const pair of pairs) {
    for (const side of [pair.a, pair.b]) {
      drafts.set(keyOf(pair, side.text), {
        surface: pair.surface,
        brief: pair.brief,
        text: side.text,
      });
    }
  }

  const call = callEditor(flags.model);
  let fresh = 0;
  const redlines = new Map<string, Redline>();
  await mapPool([...drafts], flags.concurrency, async ([key, draft]) => {
    const path = join(cache, `${key}.json`);
    if (await Bun.file(path).exists()) {
      redlines.set(key, await decodeFile(Redline, path));
      return;
    }
    const { passes, exhausted } = await settleEdits(
      draft.text,
      (text) => renderEditorPrompt(template, draft.surface, draft.brief, text),
      call,
      flags.maxPasses,
    );
    const moved = wordDistance(draft.text, passes.at(-1) ?? draft.text);
    const redline: Redline = {
      key,
      prompt: promptHash,
      model: flags.model,
      passes,
      exhausted,
      edits: moved.deleted + moved.inserted,
      distance: moved.distance,
    };
    await Bun.write(path, `${JSON.stringify(redline, null, 2)}\n`);
    redlines.set(key, redline);
    fresh++;
    console.error(
      `[${fresh}/${drafts.size}] ${key}: ${redline.edits} words in ${passes.length} passes${exhausted ? "" : " (cap)"}`,
    );
  });

  await Promise.all(
    pairs.map((pair) => {
      const a = redlines.get(keyOf(pair, pair.a.text));
      const b = redlines.get(keyOf(pair, pair.b.text));
      if (a === undefined || b === undefined) throw new Error(`${pair.id}: missing redline`);
      const judgment: Judgment = {
        id: pair.id,
        pick: pickByDistance(a[flags.metric], b[flags.metric], flags.margin),
        left: "a",
        reason: `a ${a.edits} words (${a.distance.toFixed(2)}), b ${b.edits} words (${b.distance.toFixed(2)})`,
        prompt: promptHash,
        model: flags.model,
      };
      return Bun.write(join(out, `${pair.id}.json`), `${JSON.stringify(judgment, null, 2)}\n`);
    }),
  );
  console.log(
    `redlined ${drafts.size} drafts (${fresh} freshly edited), judged ${pairs.length} pairs in ${out}`,
  );
}

function int(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new InvalidArgumentError("Not an integer.");
  return n;
}

function float(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

export const program = new Command("redline")
  .description(
    "Redline each draft in a pairs directory until the editor has no edits left, pick the draft needing less editing, and write Judgment files that pairwise.ts calibrate and score read",
  )
  .option("--pairs <dir>", "Directory of Pair JSON files")
  .option("--out <dir>", "Directory to write Judgment JSON files")
  .option("--cache <dir>", "Directory to cache each draft's redline")
  .option("--model <model>", "Editor model", "claude-opus-5-5")
  .option(
    "--prompt <file>",
    "Editor prompt template",
    join(import.meta.dirname, "editor-prompt.md"),
  )
  .option("--max-passes <n>", "Most edit passes per draft", int, 4)
  .option(
    "--margin <x>",
    "Call a tie when the two distances are within this of each other",
    float,
    0,
  )
  .addOption(
    new Option(
      "--metric <metric>",
      "Pick by words edited (edits) or by that count over the draft's length (distance)",
    )
      .choices(["edits", "distance"] as const)
      .default("edits" as const),
  )
  .option("--concurrency <n>", "Drafts edited in parallel", int, 4)
  .option(
    "--replicate <n>",
    "Redline again under a separate cache entry, to measure the editor's own noise",
    int,
    0,
  )
  .action(async (options) => {
    await judgeMain(options);
  });

if (import.meta.main) await program.parseAsync();
