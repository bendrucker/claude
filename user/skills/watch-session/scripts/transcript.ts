import { z } from "zod";

const Block = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  is_error: z.boolean().optional(),
  content: z.unknown().optional(),
});

export const Entry = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  promptSource: z.string().optional(),
  cwd: z.string().optional(),
  durationMs: z.number().optional(),
  message: z
    .looseObject({
      content: z.union([z.string(), z.array(Block)]).optional(),
    })
    .optional(),
});

export type Entry = z.output<typeof Entry>;

/** One decoded transcript line and the byte range it occupies. */
interface Line {
  entry: Entry;
  from: number;
  to: number;
}

export interface Turn {
  event: "turn";
  end: "complete" | "interrupted";
  from: number;
  to: number;
  prompt: string;
  source?: string;
  tools: Record<string, number>;
  errors: number;
  skills: string[];
  skillDirs: string[];
  final: string;
  durationMs?: number;
}

const Questions = z.object({
  questions: z.array(
    z.object({
      question: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
    }),
  ),
});

export interface Blocked {
  event: "blocked";
  at: number;
  questions: z.output<typeof Questions>["questions"];
}

/** Longest `final` text a turn digest carries, enough for the closing summary's first lines. */
const FINAL_CHARS = 300;
/** Longest prompt a turn digest carries. */
const PROMPT_CHARS = 200;
const MS_PER_SECOND = 1000;

const SKILL_DIR = /^Base directory for this skill: (\S+)/;
const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/;
// Only commands that expand into a prompt, skills and bundled commands alike, carry a command message.
const COMMAND_MESSAGE = "<command-message>";
// Output Claude Code records around a local command such as /add-dir, rather than anything the user typed.
const LOCAL_OUTPUT = "<local-command-";
const INTERRUPTED = "[Request interrupted by user";
const TASK_NOTIFICATION = "<task-notification>";
const TASK_SUMMARY = /<summary>([^<]*)<\/summary>/;

function clip(text: string, max: number): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function inputField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null || !(key in input)) return undefined;
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : undefined;
}

/** A typed slash command as `/name args`, or undefined for ordinary prompt text. */
function slashCommand(content: string): string | undefined {
  const name = COMMAND_NAME.exec(content)?.[1];
  if (name === undefined) return undefined;
  return `${name} ${COMMAND_ARGS.exec(content)?.[1] ?? ""}`.trim();
}

/** Folds transcript lines into turn digests, one per completed or interrupted turn. */
export class TurnTracker {
  private turn: Turn | undefined;
  // Local commands like /add-dir never end a turn, so the prompt is the last one before the agent answers.
  private answered = false;
  private pendingQuestion = false;

  /** Where the turn still in progress began, which a resumed read must start from to digest it whole. */
  get openFrom(): number | undefined {
    return this.turn?.from;
  }

  /** Whether the agent is waiting on an AskUserQuestion the transcript already recorded. */
  get asking(): boolean {
    return this.pendingQuestion;
  }

  feed({ entry, from, to }: Line): (Turn | Blocked)[] {
    if (entry.isSidechain) return [];
    const events: (Turn | Blocked)[] = [];

    if (entry.type === "system" && entry.subtype === "turn_duration") {
      const done = this.close("complete", to, entry.durationMs);
      return done ? [done] : [];
    }
    if (entry.type !== "user" && entry.type !== "assistant") return [];

    const turn = this.current(from);
    turn.to = to;
    const content = entry.message?.content;

    if (entry.type === "user" && typeof content === "string") {
      if (!this.answered && !content.startsWith(LOCAL_OUTPUT))
        this.prompt(turn, content, entry.promptSource);
      return events;
    }
    if (entry.type === "assistant") this.answered = true;

    for (const block of Array.isArray(content) ? content : []) {
      if (entry.type === "user") {
        if (block.type === "tool_result") this.pendingQuestion = false;
        if (block.type === "tool_result" && block.is_error) turn.errors++;
        if (block.type !== "text" || block.text === undefined) continue;
        const dir = SKILL_DIR.exec(block.text)?.[1];
        if (dir !== undefined) turn.skillDirs.push(dir);
        if (block.text.startsWith(INTERRUPTED)) {
          const done = this.close("interrupted", to);
          if (done) events.push(done);
          return events;
        }
        continue;
      }
      if (block.type === "text" && block.text !== undefined)
        turn.final = clip(block.text, FINAL_CHARS);
      if (block.type !== "tool_use" || block.name === undefined) continue;
      turn.tools[block.name] = (turn.tools[block.name] ?? 0) + 1;
      const skill = block.name === "Skill" ? inputField(block.input, "skill") : undefined;
      if (skill !== undefined) turn.skills.push(skill);
      const asked = block.name === "AskUserQuestion" ? Questions.safeParse(block.input) : undefined;
      if (asked?.success === true) {
        this.pendingQuestion = true;
        events.push({ event: "blocked", at: to, questions: asked.data.questions });
      }
    }
    return events;
  }

  private prompt(turn: Turn, content: string, source: string | undefined): void {
    const command = slashCommand(content);
    // A typed /skill loads without a Skill tool call, so its name comes from the command.
    const name = command?.split(" ")[0]?.replace(/^\//, "");
    turn.skills = name !== undefined && content.includes(COMMAND_MESSAGE) ? [name] : [];
    // A finished background task re-enters the session as a prompt, which its summary line describes.
    const task = content.startsWith(TASK_NOTIFICATION)
      ? TASK_SUMMARY.exec(content)?.[1]
      : undefined;
    turn.prompt = clip(command ?? (task === undefined ? content : `task: ${task}`), PROMPT_CHARS);
    if (source === undefined) delete turn.source;
    else turn.source = source;
  }

  private current(from: number): Turn {
    this.turn ??= {
      event: "turn",
      end: "complete",
      from,
      to: from,
      prompt: "",
      tools: {},
      errors: 0,
      skills: [],
      skillDirs: [],
      final: "",
    };
    return this.turn;
  }

  private close(end: Turn["end"], to: number, durationMs?: number): Turn | undefined {
    const turn = this.turn;
    this.turn = undefined;
    this.answered = false;
    this.pendingQuestion = false;
    if (!turn) return undefined;
    const done: Turn = { ...turn, end, to };
    if (durationMs !== undefined) done.durationMs = durationMs;
    return done;
  }
}

// Claude Code adds line types over time, so a line that fails to parse is skipped rather than fatal.
function parseEntry(text: string): Entry | undefined {
  if (text.trim() === "") return undefined;
  try {
    const result = Entry.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/**
 * Splits newly read bytes into complete lines with absolute byte offsets.
 * A trailing partial line is left unconsumed for the next read.
 */
export function splitLines(bytes: Uint8Array, base: number): { lines: Line[]; consumed: number } {
  const decoder = new TextDecoder();
  const lines: Line[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 10) continue;
    const text = decoder.decode(bytes.subarray(start, i));
    const entry = parseEntry(text);
    if (entry) lines.push({ entry, from: base + start, to: base + i + 1 });
    start = i + 1;
  }
  return { lines, consumed: start };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => inputField(part, "text") ?? "").join(" ");
  }
  return value === undefined ? "" : JSON.stringify(value);
}

/** Renders a transcript range as one compact line per message block, for close reading. */
export function render(lines: Line[], max: number): string[] {
  const out: string[] = [];
  for (const { entry } of lines) {
    if (entry.isSidechain) continue;
    const content = entry.message?.content;
    if (entry.type === "system" && entry.subtype === "turn_duration") {
      out.push(`-- turn end (${Math.round((entry.durationMs ?? 0) / MS_PER_SECOND)}s)`);
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (typeof content === "string") {
      out.push(`${entry.isMeta ? "meta" : "user"}: ${clip(content, max)}`);
      continue;
    }
    for (const block of content ?? []) {
      if (block.type === "text" && block.text !== undefined)
        out.push(`${entry.type}: ${clip(block.text, max)}`);
      if (block.type === "tool_use")
        out.push(`tool ${block.name}: ${clip(stringify(block.input), max)}`);
      if (block.type === "tool_result") {
        out.push(`result${block.is_error ? " ERROR" : ""}: ${clip(stringify(block.content), max)}`);
      }
    }
  }
  return out;
}
