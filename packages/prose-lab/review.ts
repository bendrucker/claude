import { homedir } from "node:os";
import { join } from "node:path";
import type { InlineCode, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import { z } from "zod";
import { entries, type Flag, readJsonl } from "./data";

const FEEDBACK = join(homedir(), ".plannotator", "feedback");

export const Annotation = z.object({
  type: z.string(),
  text: z.string().default(""),
  originalText: z.string().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

const FeedbackRecord = z.object({
  ts: z.string(),
  surface: z.string(),
  target: z.object({ filePath: z.string().optional() }).optional(),
  annotations: z.array(Annotation).default([]),
});

export interface Located {
  line: number;
  /** Vale's one-based inclusive columns. */
  span: [number, number];
}

interface Rendered {
  char: string;
  /** Offset into the raw source, or -1 for a break between blocks. */
  offset: number;
  /** A code span's opening and closing delimiters, on its first and last characters. */
  from?: number;
  to?: number;
}

/** The document as Plannotator renders it, each character tied to its raw offset. */
function rendered(raw: string): Rendered[] {
  const out: Rendered[] = [];
  let previousEnd = 0;
  visit(fromMarkdown(raw), (node) => {
    if (node.type !== "text" && node.type !== "inlineCode") return;
    const { value, position } = node satisfies Text | InlineCode;
    if (position?.start.offset === undefined || position.end.offset === undefined) return;
    const [start, end] = [position.start.offset, position.end.offset];
    if (raw.slice(previousEnd, start).includes("\n")) out.push({ char: " ", offset: -1 });
    // Escapes, indentation, and code-span backticks sit in the raw text but not the value, so walk past them.
    let at = start;
    const first = out.length;
    // Walk UTF-16 code units, the unit the quote's length counts in.
    for (let i = 0; i < value.length; i++) {
      const char = value.charAt(i);
      const match = raw.indexOf(char, at);
      // A character with no raw counterpart, such as a decoded entity, must not strand the rest of the node.
      if (match === -1 || match >= end) {
        out.push({ char, offset: -1 });
        continue;
      }
      out.push({ char, offset: match });
      at = match + 1;
    }
    const last = out.at(-1);
    if (node.type === "inlineCode" && out[first] !== undefined && last !== undefined) {
      out[first].from = start;
      last.to = end - 1;
    }
    previousEnd = end;
  });
  return out;
}

/** Where a quote from the rendered document sits in the raw lines, one span per line it covers. */
export function locate(lines: readonly string[], quote: string): Located[] {
  const raw = lines.join("\n");
  const collapsed = rendered(raw).filter(
    (entry, i, all) => !/\s/.test(entry.char) || i === 0 || !/\s/.test(all[i - 1]?.char ?? ""),
  );
  const needle = quote.trim().replaceAll(/\s+/g, " ");
  const text = collapsed.map((entry) => (/\s/.test(entry.char) ? " " : entry.char)).join("");
  const found = needle === "" ? -1 : text.indexOf(needle);
  // A quote that appears twice could mark either copy. Leave it unlocated instead of guessing.
  if (found === -1 || text.includes(needle, found + 1)) return [];

  const starts = [0];
  for (const line of lines) starts.push((starts.at(-1) ?? 0) + line.length + 1);
  const spans = new Map<number, [number, number]>();
  for (const { char, offset, from = offset, to = offset } of collapsed.slice(
    found,
    found + needle.length,
  )) {
    if (offset === -1 || /\s/.test(char)) continue;
    const index = starts.findLastIndex((start) => start <= offset);
    const column = (at: number): number => at - (starts[index] ?? 0) + 1;
    const span = spans.get(index + 1);
    spans.set(index + 1, [Math.min(span?.[0] ?? column(from), column(from)), column(to)]);
  }
  return [...spans].map(([line, span]) => ({ line, span }));
}

/** The annotations from the newest Plannotator annotate session on `path` since `since`. */
export async function annotations(
  path: string,
  since: Date,
  feedback = FEEDBACK,
): Promise<Annotation[]> {
  // Plannotator's JSON output omits the annotations. Only its feedback index records them.
  const indexes = (await entries(feedback))
    .map((dir) => join(feedback, dir, "index.jsonl"))
    .filter((index) => Bun.file(index).lastModified >= since.getTime());
  const sessions = (await Promise.all(indexes.map((index) => readJsonl(z.unknown(), index))))
    .flat()
    .flatMap((line) => {
      const parsed = FeedbackRecord.safeParse(line);
      return parsed.success ? [parsed.data] : [];
    })
    .filter(
      (record) =>
        record.surface === "annotate" &&
        record.target?.filePath === path &&
        new Date(record.ts) >= since,
    )
    .toSorted((a, b) => a.ts.localeCompare(b.ts));
  return sessions.at(-1)?.annotations ?? [];
}

export interface Reviewed {
  flags: Flag[];
  /** Annotations other than global comments that no span was found for. */
  unlocated: Annotation[];
  globals: string[];
}

/** Each inline comment as unassigned flags on `file`, keyed as the lab page keys them. */
export function toFlags(
  found: readonly Annotation[],
  file: string,
  lines: readonly string[],
  ts: string,
): Reviewed {
  const reviewed: Reviewed = { flags: [], unlocated: [], globals: [] };
  for (const annotation of found) {
    if (annotation.type === "GLOBAL_COMMENT") {
      reviewed.globals.push(annotation.text);
      continue;
    }
    const spans = annotation.type === "COMMENT" ? locate(lines, annotation.originalText ?? "") : [];
    if (spans.length === 0) reviewed.unlocated.push(annotation);
    for (const { line, span } of spans) {
      reviewed.flags.push({
        id: `${file}|${line}|${span[0]}`,
        file,
        line,
        span,
        match: lines[line - 1]?.slice(span[0] - 1, span[1]) ?? "",
        note: annotation.text,
        ts,
      });
    }
  }
  return reviewed;
}
