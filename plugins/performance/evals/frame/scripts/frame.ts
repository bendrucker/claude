import { mean } from "simple-statistics";
import { z } from "zod";

const Patterns = z.array(z.string());

export const FrameTruth = z.object({
  kind: z.literal("frame"),
  /** The notes file the case asks for, relative to the session's working directory. */
  notes: z.string(),
  rules: z.string(),
  checkpoint: z.string(),
  checks: z.array(
    z.object({
      id: z.string(),
      where: z.enum(["notes", "rules", "either"]),
      note: z.string(),
      /** Pattern groups that one paragraph or list item must each match. */
      all: z.array(Patterns),
    }),
  ),
  assumed: z.object({
    marker: z.string(),
    items: z.array(z.object({ id: z.string(), patterns: Patterns })),
  }),
});
export type FrameTruth = z.output<typeof FrameTruth>;

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^\s?([-*+]|\d+[.)])\s|^\s*\|/;

/** Paragraphs, top-level list items, table rows, and headings. */
export function units(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) out.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "" || HEADING.test(line)) {
      flush();
      if (line.trim() !== "") out.push(line);
      continue;
    }
    if (ITEM.test(line)) flush();
    current.push(line);
  }
  flush();
  return out;
}

/** The body under the first heading matching `title`, up to the next heading at its level. */
export function section(text: string, title: RegExp): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => title.test(HEADING.exec(l)?.[2] ?? ""));
  if (start === -1) return "";
  const level = HEADING.exec(lines[start] ?? "")?.[1]?.length ?? 0;
  const end = lines.findIndex((l, i) => i > start && (HEADING.exec(l)?.[1]?.length ?? 7) <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

const Write = z.object({
  type: z.literal("tool_use"),
  name: z.literal("Write"),
  input: z.object({ file_path: z.string(), content: z.string() }),
});
const Edit = z.object({
  type: z.literal("tool_use"),
  name: z.literal("Edit"),
  input: z.object({
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
});
const Assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({ content: z.array(z.unknown()) }),
});

/** The notes file as the session left it, replayed from its Write and Edit calls. */
export function notesFromTrace(trace: string, path: string): string | undefined {
  let notes: string | undefined;
  const matches = (file: string) => file === path || file.endsWith(`/${path}`);
  for (const line of trace.trim().split("\n")) {
    const entry = Assistant.safeParse(JSON.parse(line));
    if (!entry.success) continue;
    for (const block of entry.data.message.content) {
      const write = Write.safeParse(block);
      if (write.success && matches(write.data.input.file_path)) notes = write.data.input.content;
      const edit = Edit.safeParse(block);
      if (edit.success && matches(edit.data.input.file_path) && notes !== undefined) {
        const { old_string: from, new_string: to, replace_all: all } = edit.data.input;
        notes = all === true ? notes.replaceAll(from, to) : notes.replace(from, to);
      }
    }
  }
  return notes;
}

export interface FrameScore {
  notes: boolean;
  checks: Record<string, boolean>;
  /** Share of the brief's unsettled items whose Rules entry carries the assumed marker. */
  assumed: number;
  checkpoint: boolean;
  /** Mean of every check, the checkpoint, and `assumed`. */
  composite: number;
}

const any = (patterns: string[]) => {
  const res = patterns.map((p) => new RegExp(p, "i"));
  return (text: string) => res.some((re) => re.test(text));
};

export function scoreFrame(
  reply: string,
  notes: string | undefined,
  truth: FrameTruth,
): FrameScore {
  const doc = notes ?? "";
  const rules = section(doc, new RegExp(truth.rules, "i"));
  const scopes = {
    notes: units(doc),
    rules: units(rules),
    either: [...units(doc), ...units(reply)],
  };
  const checks = Object.fromEntries(
    truth.checks.map((c) => {
      const groups = c.all.map(any);
      return [c.id, scopes[c.where].some((u) => groups.every((g) => g(u)))];
    }),
  );
  const marker = new RegExp(truth.assumed.marker, "i");
  const ruleUnits = units(rules);
  const marked = truth.assumed.items.filter((item) => {
    const named = any(item.patterns);
    return ruleUnits.some((u) => named(u) && marker.test(u));
  });
  const assumed = marked.length / truth.assumed.items.length;
  const checkpoint = section(doc, new RegExp(truth.checkpoint, "i")).trim() !== "";
  const parts = [...Object.values(checks).map(Number), Number(checkpoint), assumed];
  return { notes: notes !== undefined, checks, assumed, checkpoint, composite: mean(parts) };
}
