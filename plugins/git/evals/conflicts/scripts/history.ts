#!/usr/bin/env bun
// Generates a deterministic prior-session transcript for a case. Real invocations start with a long inherited conversation.

import { Command } from "@commander-js/extra-typings";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

export const REPO_ROOT = resolve(import.meta.dir, "../../../../..");

// Public repo files are read at this commit, so later edits to them never change a generated history.
export const SOURCE_REF = "e24090525c39a2b4d3d34d79e3b836519ca4332a";
export const TARGET_TOKENS = 100_000;
export const TOKEN_RANGE = { min: 95_000, max: 110_000 } as const;

const CWD = "/Users/ben/src/bendrucker/claude";
const VERSION = "2.1.280";
const MODEL = "claude-opus-5-5";
const START = Date.UTC(2026, 8, 29, 14, 0, 0);
const MAX_FILE_CHARS = 14_000;
const EXCLUDED = /ts\.net|tailnet|\.local\b|\.lan\b|\.internal\b/i;
const PUBLIC_FILE =
  /^(README\.md|docs\/[^/]+\.md|plugins\/[^/]+\/README\.md|plugins\/[^/]+\/skills\/[^/]+\/(SKILL|references\/[^/]+)\.md|scripts\/[^/]+\.ts|user\/rules\/[^/]+\.md)$/;

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type Entry =
  | { role: "user"; content: string }
  | { role: "user"; content: ToolResult[] }
  | { role: "assistant"; content: Block[] };

interface Hunk {
  old: string;
  next: string;
  added: number;
  removed: number;
}

interface Section {
  path: string;
  lines: string[];
  hunks: Hunk[];
}

interface Draft {
  old: string[];
  next: string[];
  added: number;
  removed: number;
}

interface Opening {
  start: Transcript;
  fixed: Transcript;
  sources: Set<string>;
}

function digest(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function uuid(seed: string): string {
  const h = digest(seed);
  const variant = (8 + (Number.parseInt(h.slice(16, 17), 16) % 4)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function sourceAvailable(): boolean {
  return (
    Bun.spawnSync(["git", "-C", REPO_ROOT, "cat-file", "-e", `${SOURCE_REF}^{commit}`]).exitCode ===
    0
  );
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", REPO_ROOT, ...args]);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function pathOf(line: string): string {
  const path = line.split(" b/")[1];
  if (path === undefined) throw new Error(`no path in diff header: ${line}`);
  return path;
}

function parsePatch(text: string): Section[] {
  const sections: Section[] = [];
  let section: Section | undefined;
  let hunk: Draft | undefined;
  const flush = () => {
    if (section !== undefined && hunk !== undefined) {
      section.hunks.push({
        old: hunk.old.join("\n"),
        next: hunk.next.join("\n"),
        added: hunk.added,
        removed: hunk.removed,
      });
    }
    hunk = undefined;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      section = { path: pathOf(line), lines: [], hunks: [] };
      sections.push(section);
    } else if (section === undefined) {
      continue;
    } else if (line.startsWith("@@")) {
      flush();
      hunk = { old: [], next: [], added: 0, removed: 0 };
    } else if (hunk !== undefined && line.startsWith("+")) {
      hunk.next.push(line.slice(1));
      hunk.added++;
      section.lines.push(line.slice(1));
    } else if (hunk !== undefined && line.startsWith("-")) {
      hunk.old.push(line.slice(1));
      hunk.removed++;
    } else if (hunk !== undefined && line.startsWith(" ")) {
      hunk.old.push(line.slice(1));
      hunk.next.push(line.slice(1));
    }
  }
  flush();
  return sections;
}

function numbered(text: string): string {
  return text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
    .join("\n");
}

function isPublicFile(path: string): boolean {
  return PUBLIC_FILE.test(path) && !path.endsWith(".test.ts");
}

function publicFiles(): string[] {
  const files = git("ls-tree", "-r", "--name-only", SOURCE_REF)
    .split("\n")
    .filter(Boolean)
    .toSorted()
    .filter((path) => isPublicFile(path));
  const herdr = files.filter((path) => path.startsWith("plugins/herdr/"));
  return [...herdr, ...files.filter((path) => !path.startsWith("plugins/herdr/"))];
}

const publicCache = new Map<string, string | undefined>();

function readPublic(path: string): string | undefined {
  if (publicCache.has(path)) return publicCache.get(path);
  const text = git("show", `${SOURCE_REF}:${path}`);
  let body: string | undefined;
  if (!EXCLUDED.test(text)) {
    const kept: string[] = [];
    let size = 0;
    for (const line of text.replace(/\n$/, "").split("\n")) {
      size += line.length + 8;
      if (size > MAX_FILE_CHARS) break;
      kept.push(line);
    }
    body = numbered(kept.join("\n"));
  }
  publicCache.set(path, body);
  return body;
}

function contentChars(entries: Entry[]): number {
  let total = 0;
  for (const entry of entries) {
    if (typeof entry.content === "string") {
      total += entry.content.length;
      continue;
    }
    for (const block of entry.content) {
      if (block.type === "text") total += block.text.length;
      else if (block.type === "tool_use") total += JSON.stringify(block.input).length;
      else total += block.content.length;
    }
  }
  return total;
}

const Line = z.object({
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  type: z.enum(["user", "assistant"]),
  message: z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  }),
});

export function parseLines(jsonl: string): z.infer<typeof Line>[] {
  return jsonl
    .split("\n")
    .filter(Boolean)
    .map((line) => Line.parse(JSON.parse(line)));
}

export function estimateTokens(jsonl: string): number {
  let chars = 0;
  for (const { message } of parseLines(jsonl)) {
    if (typeof message.content === "string") {
      chars += message.content.length;
      continue;
    }
    for (const block of message.content) {
      if (typeof block.text === "string") chars += block.text.length;
      else if (typeof block.content === "string") chars += block.content.length;
      else chars += JSON.stringify(block.input ?? "").length;
    }
  }
  return Math.round(chars / 4);
}

class Transcript {
  entries: Entry[] = [];
  private calls = 0;
  constructor(private readonly seed: string) {}

  user(text: string) {
    this.entries.push({ role: "user", content: text });
  }

  say(text: string) {
    this.entries.push({ role: "assistant", content: [{ type: "text", text }] });
  }

  call(name: string, input: Record<string, unknown>, result: string, text?: string) {
    const id = `toolu_${digest(`${this.seed}:tool:${this.calls++}`).slice(0, 24)}`;
    const blocks: Block[] = [];
    if (text !== undefined) blocks.push({ type: "text", text });
    blocks.push({ type: "tool_use", id, name, input });
    this.entries.push({ role: "assistant", content: blocks });
    this.entries.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: result }],
    });
  }

  read(path: string, body: string, text?: string) {
    this.call("Read", { file_path: `${CWD}/${path}` }, body, text);
  }
}

const READ_LEADS = [
  "Checking how this plugin documents itself.",
  "Reading the next doc for conventions.",
  "One more file that may describe the record.",
  "Looking at a neighboring plugin for the same pattern.",
  "Reading this for how scripts are laid out.",
  "Checking the rules that apply here.",
];

function addFiller(transcript: Transcript, files: string[]) {
  for (const [i, path] of files.entries()) {
    const body = readPublic(path);
    if (body === undefined) continue;
    transcript.read(path, body, i % 3 === 0 ? READ_LEADS[(i / 3) % READ_LEADS.length] : undefined);
  }
}

function fillerWithin(budgetChars: number, skip: Set<string>): string[] {
  const chosen: string[] = [];
  let used = 0;
  for (const path of publicFiles()) {
    if (skip.has(path)) continue;
    const body = readPublic(path);
    if (body === undefined) continue;
    if (used + body.length > budgetChars) {
      if (budgetChars - used > 4_000) continue;
      break;
    }
    chosen.push(path);
    used += body.length;
  }
  return chosen;
}

// A `-long` case reuses the history/ of the sibling it is named for.
async function historyDir(caseDir: string): Promise<string> {
  const own = join(caseDir, "history");
  return (await Bun.file(join(own, "branch.name")).exists())
    ? own
    : join(caseDir.replace(/-long$/, ""), "history");
}

async function opening(caseDir: string): Promise<Opening> {
  const history = await historyDir(caseDir);
  const base = parsePatch(await Bun.file(join(history, "base.patch")).text());
  const branchDir = join(history, "branch");
  const patches = readdirSync(branchDir)
    .filter((f) => f.endsWith(".patch"))
    .toSorted();
  const texts = await Promise.all(patches.map((patch) => Bun.file(join(branchDir, patch)).text()));
  const branch = texts.flatMap((text) => parsePatch(text));
  const first = patches[0];
  if (first === undefined) throw new Error(`no branch patches in ${branchDir}`);
  const message = (await Bun.file(join(branchDir, first.replace(".patch", ".msg"))).text()).trim();
  const name = (await Bun.file(join(history, "branch.name")).text()).trim();

  const start = new Transcript(name);
  start.user(
    `${message}. When another process holds the git config lock, the worktree write fails and the agent never starts. Retry the write a few times, and if it still fails, record it on the result and start the agent anyway. Read the plugin's docs first so the change matches how it describes the record.`,
  );

  const edited = new Set(branch.map((section) => section.path));
  const sources = base.filter(
    (section) => section.path.endsWith(".ts") || section.path.endsWith("package.json"),
  );
  const ordered = sources.toSorted(
    (a, b) => Number(edited.has(b.path)) - Number(edited.has(a.path)),
  );
  const fixed = new Transcript(name);
  fixed.say("I have the request. Reading the dispatch script, its tests, and what it records.");
  for (const section of ordered) {
    fixed.read(section.path, numbered(section.lines.join("\n")));
  }
  for (const section of branch) {
    for (const [i, hunk] of section.hunks.entries()) {
      fixed.call(
        "Edit",
        { file_path: `${CWD}/${section.path}`, old_string: hunk.old, new_string: hunk.next },
        `The file ${CWD}/${section.path} has been updated successfully.`,
        i === 0 ? `Editing \`${section.path}\`.` : undefined,
      );
    }
  }
  const stat = branch
    .map((section) => {
      const added = section.hunks.reduce((n, h) => n + h.added, 0);
      const removed = section.hunks.reduce((n, h) => n + h.removed, 0);
      return ` ${section.path} | ${added + removed} ${"+".repeat(Math.min(added, 20))}${"-".repeat(Math.min(removed, 20))}`;
    })
    .join("\n");
  fixed.call(
    "Bash",
    { command: "git diff --stat", description: "Show the change size" },
    `${stat}\n ${branch.length} files changed`,
  );
  fixed.say(
    `The dispatch script now retries a worktree config write that loses the lock, and a lock that outlasts the retries is recorded on the result while the agent still starts. The tests cover both outcomes. I have not run them yet.`,
  );
  return { start, fixed, sources: new Set(base.map((s) => s.path)) };
}

export async function build(caseDir: string): Promise<string> {
  const head = await opening(caseDir);
  const name = (await Bun.file(join(await historyDir(caseDir), "branch.name")).text()).trim();
  const fixedChars = contentChars(head.start.entries) + contentChars(head.fixed.entries);
  const followUp =
    "Before I push this, skim the other plugins' docs for anything that describes dispatch retries or the result record, so I know whether any of them need a matching edit.";
  const budget = TARGET_TOKENS * 4 - fixedChars - followUp.length - 2_000;
  const filler = fillerWithin(budget, head.sources);
  const split = Math.ceil(filler.length / 2);

  const transcript = new Transcript(name);
  transcript.entries.push(...head.start.entries);
  addFiller(transcript, filler.slice(0, split));
  transcript.entries.push(...head.fixed.entries);
  transcript.user(followUp);
  transcript.say("Reading the remaining docs and scripts for mentions of the record.");
  addFiller(transcript, filler.slice(split));
  transcript.call(
    "Grep",
    {
      pattern: "trackingError|lock-retry|retry the write",
      path: CWD,
      output_mode: "files_with_matches",
    },
    "No files found",
  );
  transcript.say(
    "None of the other docs describe dispatch retries or the result record, so nothing else needs a matching edit. The change is limited to the dispatch script and its tests.",
  );
  return serialize(transcript, name);
}

function messageOf(entry: Entry, name: string, i: number) {
  if (entry.role === "user") return { role: "user", content: entry.content };
  return {
    id: `msg_${digest(`${name}:msg:${i}`).slice(0, 24)}`,
    type: "message",
    role: "assistant",
    model: MODEL,
    content: entry.content,
    stop_reason: entry.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function serialize(transcript: Transcript, name: string): string {
  const sessionId = uuid(`${name}:session`);
  let parent: string | null = null;
  let time = START;
  const lines: string[] = [];
  for (const [i, entry] of transcript.entries.entries()) {
    const id = uuid(`${name}:${i}`);
    time += 2_000 + (Number.parseInt(digest(`${name}:t:${i}`).slice(0, 4), 16) % 38_000);
    lines.push(
      JSON.stringify({
        parentUuid: parent,
        isSidechain: false,
        userType: "external",
        cwd: CWD,
        sessionId,
        version: VERSION,
        gitBranch: name,
        type: entry.role,
        message: messageOf(entry, name, i),
        uuid: id,
        timestamp: new Date(time).toISOString(),
      }),
    );
    parent = id;
  }
  return `${lines.join("\n")}\n`;
}

export async function drifted(caseDir: string): Promise<boolean> {
  const file = Bun.file(join(caseDir, "history.jsonl"));
  return !(await file.exists()) || (await file.text()) !== (await build(caseDir));
}

export const program = new Command("history")
  .description("Write a case's inherited prior-session transcript to history.jsonl.")
  .argument("<case-dir>", "case directory holding history/")
  .option("--check", "exit 1 when history.jsonl differs from what would be generated")
  .action(async (caseDir, options) => {
    const dir = resolve(caseDir);
    if (options.check === true) {
      if (await drifted(dir)) {
        console.error(`${caseDir}/history.jsonl is stale: regenerate with history.ts ${caseDir}`);
        process.exit(1);
      }
      return;
    }
    const output = await build(dir);
    await Bun.write(join(dir, "history.jsonl"), output);
    console.log(`${caseDir}/history.jsonl: ~${estimateTokens(output)} tokens`);
  });

if (import.meta.main) {
  await program.parseAsync();
}
