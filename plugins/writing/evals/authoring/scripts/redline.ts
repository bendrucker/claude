#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { globSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { cli } from "cleye";
import { z } from "zod";
import { decode, decodeFile, decodeJson } from "../../../../../packages/decode/index";
import { tokenize } from "../../writing/label/align";
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

export type EditCall = (prompt: string) => Promise<string>;

/**
 * Edits `draft` repeatedly until a pass changes less than `settle` of the words it was given,
 * or `maxPasses` passes have run. Returns the text after each pass.
 */
export async function settleEdits(
  draft: string,
  render: (text: string) => string,
  call: EditCall,
  maxPasses: number,
  settle: number,
): Promise<string[]> {
  const pass = async (text: string, remaining: number): Promise<string[]> => {
    if (remaining === 0) return [];
    const next = await call(render(text));
    if (wordDistance(text, next).distance < settle) return [next];
    return [next, ...(await pass(next, remaining - 1))];
  };
  return pass(draft, maxPasses);
}

export const Redline = z.object({
  key: z.string(),
  prompt: z.string(),
  model: z.string(),
  passes: z.array(z.string()),
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

const EditReply = z.object({ text: z.string() });

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
            properties: { text: { type: "string" } },
            required: ["text"],
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
      return reply.text;
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
  pairs: string | undefined;
  out: string | undefined;
  cache: string | undefined;
  model: string;
  prompt: string;
  maxPasses: number;
  settle: number;
  margin: number;
  concurrency: number;
}

async function judgeMain(flags: JudgeFlags): Promise<void> {
  const { pairs: pairsDir, out, cache } = flags;
  if (pairsDir === undefined || out === undefined || cache === undefined) {
    throw new Error("--pairs, --out, and --cache are required");
  }
  const template = await Bun.file(flags.prompt).text();
  const promptHash = hash(template, String(flags.maxPasses), String(flags.settle)).slice(0, 12);
  const pairs = await Promise.all(
    globSync("*.json", { cwd: pairsDir })
      .toSorted()
      .map((f) => decodeFile(Pair, join(pairsDir, f))),
  );
  await Promise.all([mkdir(out, { recursive: true }), mkdir(cache, { recursive: true })]);

  const drafts = new Map<string, { surface: string; brief: string; text: string }>();
  const keyOf = (pair: Pair, text: string) =>
    hash(promptHash, flags.model, pair.surface, pair.brief, text);
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
    const passes = await settleEdits(
      draft.text,
      (text) => renderEditorPrompt(template, draft.surface, draft.brief, text),
      call,
      flags.maxPasses,
      flags.settle,
    );
    const redline: Redline = {
      key,
      prompt: promptHash,
      model: flags.model,
      passes,
      distance: wordDistance(draft.text, passes.at(-1) ?? draft.text).distance,
    };
    await Bun.write(path, `${JSON.stringify(redline, null, 2)}\n`);
    redlines.set(key, redline);
    fresh++;
    console.error(
      `[${fresh}/${drafts.size}] ${key}: ${redline.distance.toFixed(2)} in ${passes.length} passes`,
    );
  });

  await Promise.all(
    pairs.map((pair) => {
      const a = redlines.get(keyOf(pair, pair.a.text));
      const b = redlines.get(keyOf(pair, pair.b.text));
      if (a === undefined || b === undefined) throw new Error(`${pair.id}: missing redline`);
      const judgment: Judgment = {
        id: pair.id,
        pick: pickByDistance(a.distance, b.distance, flags.margin),
        left: "a",
        reason: `a ${a.distance.toFixed(3)} (${a.passes.length} passes), b ${b.distance.toFixed(3)} (${b.passes.length} passes)`,
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

if (import.meta.main) {
  await cli(
    {
      name: "redline",
      help: {
        description:
          "Edit each draft in a pairs directory to a fixed point, pick the draft needing less editing, and write Judgment files that pairwise.ts calibrate and score read",
      },
      flags: {
        pairs: { type: String, description: "Directory of Pair JSON files" },
        out: { type: String, description: "Directory to write Judgment JSON files" },
        cache: { type: String, description: "Directory to cache each draft's redline" },
        model: { type: String, default: "claude-opus-5-5", description: "Editor model" },
        prompt: {
          type: String,
          default: join(import.meta.dirname, "editor-prompt.md"),
          description: "Editor prompt template",
        },
        maxPasses: { type: Number, default: 4, description: "Most edit passes per draft" },
        settle: {
          type: Number,
          default: 0.02,
          description: "Stop once a pass changes less than this share of words",
        },
        margin: {
          type: Number,
          default: 0,
          description: "Call a tie when the two distances are within this of each other",
        },
        concurrency: { type: Number, default: 4, description: "Drafts edited in parallel" },
      },
    },
    async (parsed) => {
      await judgeMain(parsed.flags);
    },
  );
}
