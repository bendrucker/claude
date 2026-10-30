#!/usr/bin/env bun
// oxlint-disable-next-line no-restricted-imports -- Bun has no append, and a read-then-write could drop a concurrent run's line.
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { table } from "table";
import { z } from "zod";
import { AGENT_FACING } from "./scan";

export const CLASSES = [
  "no-op",
  "stale-guard",
  "emphasis",
  "duplication",
  "cache",
  "relevance",
  "choreography",
  "delegation",
] as const;

const Proposal = z.object({
  id: z.string(),
  file: z.string(),
  quote: z.string(),
  replacement: z.string(),
  class: z.enum(CLASSES),
  reason: z.string(),
});

// `removed` and `inserted` are the exact bytes taken out of and put into the file, including
// any whitespace trimmed around a deletion. `before` and `after` are the text on either side
// of the edit in the file once the whole round was applied.
const Applied = Proposal.pick({ id: true, file: true, class: true }).extend({
  removed: z.string(),
  inserted: z.string(),
  before: z.string(),
  after: z.string(),
});

const Rejection = z.object({ id: z.string(), reason: z.string(), reverted: z.boolean() });

export type Proposal = z.infer<typeof Proposal>;
export type Applied = z.infer<typeof Applied>;
export type Rejection = z.infer<typeof Rejection>;

export interface Unit {
  unit: string;
  files: string[];
}

export interface Unlocated {
  id: string;
  file: string;
  why: "missing" | "ambiguous" | "no such file";
}

type Env = Record<string, string | undefined>;

const CONTEXT = 60;
const ANCHORS = [60, 30, 15, 8];

export const APPLIED_FILE = "applied.jsonl";
export const REJECTIONS_FILE = "rejections.jsonl";
export const EVENTS_DIR_VAR = "PROMPTING_AUDIT_EVENTS_DIR";

async function git(root: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${stderr.trim()}`);
  return stdout;
}

export async function toplevel(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

async function repoName(root: string): Promise<string> {
  const url = await git(root, ["remote", "get-url", "origin"]).catch(() => "");
  const name = /([^/:]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];
  return name ?? basename(root);
}

async function readJsonl<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = await Bun.file(path).text();
  return text.split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [schema.parse(JSON.parse(line))];
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${String(error)}`, { cause: error });
    }
  });
}

async function readOptionalJsonl<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  return (await Bun.file(path).exists()) ? readJsonl(path, schema) : [];
}

async function writeJsonl(path: string, rows: readonly unknown[]): Promise<void> {
  await Bun.write(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

export function runOf(ledger: string): string {
  return basename(dirname(resolve(ledger)));
}

function siblings(ledger: string): { applied: string; rejections: string } {
  const dir = dirname(resolve(ledger));
  return { applied: join(dir, APPLIED_FILE), rejections: join(dir, REJECTIONS_FILE) };
}

const isBlank = (text: string): boolean => /^[ \t]*$/.test(text);

/**
 * The span to cut for a deletion of `text[start, end)`. A quote that fills whole lines takes
 * its newline, plus one adjoining blank line when that would leave two in a row. A quote
 * inside a line takes the spaces on one side.
 */
function deletionSpan(text: string, start: number, end: number): [number, number] {
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline;
  const leading = isBlank(text.slice(lineStart, start));
  const trailing = isBlank(text.slice(end, lineEnd));

  if (leading && trailing) {
    let from = lineStart;
    let to = newline === -1 ? lineEnd : lineEnd + 1;
    const afterBlank = text[to] === "\n";
    const beforeBlank = from >= 2 && text[from - 1] === "\n" && text[from - 2] === "\n";
    if (from === 0 && afterBlank) {
      while (text[to] === "\n") to++;
    } else if (beforeBlank && (afterBlank || to === text.length)) {
      from--;
    } else if (newline === -1 && from > 0) {
      from--;
    }
    return [from, to];
  }
  let from = start;
  let to = end;
  if (leading) {
    while (text[to] === " " || text[to] === "\t") to++;
  } else if (trailing) {
    while (text[from - 1] === " " || text[from - 1] === "\t") from--;
  } else if (text[from - 1] === " " && text[to] === " ") {
    to++;
  }
  return [from, to];
}

interface Edit {
  text: string;
  start: number;
  removed: string;
  inserted: string;
}

export function edit(
  text: string,
  quote: string,
  replacement: string,
): Edit | "missing" | "ambiguous" {
  const at = quote === "" ? -1 : text.indexOf(quote);
  if (at === -1) return "missing";
  if (text.includes(quote, at + 1)) return "ambiguous";
  const [start, end] =
    replacement === "" ? deletionSpan(text, at, at + quote.length) : [at, at + quote.length];
  return {
    text: text.slice(0, start) + replacement + text.slice(end),
    start,
    removed: text.slice(start, end),
    inserted: replacement,
  };
}

/**
 * Undoes an applied edit, locating it by what it inserted and the text around it, trying
 * shorter anchors when neighbors have since changed. Undefined when no anchor is unique.
 */
export function unedit(text: string, applied: Applied): string | undefined {
  const { before, after, inserted, removed } = applied;
  const anchors: [string, string][] = [
    ...ANCHORS.map((n): [string, string] => [before.slice(-n), after.slice(0, n)]),
    ...ANCHORS.map((n): [string, string] => [before.slice(-n), ""]),
    ...ANCHORS.map((n): [string, string] => ["", after.slice(0, n)]),
  ];
  for (const [head, tail] of anchors) {
    const needle = head + inserted + tail;
    if (needle === "") continue;
    const at = text.indexOf(needle);
    if (at === -1 || text.includes(needle, at + 1)) continue;
    const start = at + head.length;
    return text.slice(0, start) + removed + text.slice(start + inserted.length);
  }
  return undefined;
}

async function readFiles(root: string, files: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(files)];
  const texts = await Promise.all(
    unique.map((file) =>
      Bun.file(join(root, file))
        .text()
        .catch(() => undefined),
    ),
  );
  return new Map(unique.flatMap((file, i) => (texts[i] === undefined ? [] : [[file, texts[i]]])));
}

async function writeFiles(
  root: string,
  files: ReadonlySet<string>,
  texts: ReadonlyMap<string, string>,
): Promise<void> {
  await Promise.all([...files].map((file) => Bun.write(join(root, file), texts.get(file) ?? "")));
}

export interface ApplyResult {
  applied: Applied[];
  unlocated: Unlocated[];
}

interface Point {
  applied: Omit<Applied, "before" | "after">;
  at: number;
}

/** Edits the working tree and returns what changed. Proposals apply in ledger order. */
export async function applyProposals(
  root: string,
  proposals: readonly Proposal[],
): Promise<ApplyResult> {
  const texts = await readFiles(
    root,
    proposals.map((proposal) => proposal.file),
  );
  const edited = new Set<string>();
  const points = new Map<string, Point[]>();
  const unlocated: Unlocated[] = [];

  for (const proposal of proposals) {
    const text = texts.get(proposal.file);
    if (text === undefined) {
      unlocated.push({ id: proposal.id, file: proposal.file, why: "no such file" });
      continue;
    }
    const result = edit(text, proposal.quote, proposal.replacement);
    if (typeof result === "string") {
      unlocated.push({ id: proposal.id, file: proposal.file, why: result });
      continue;
    }
    const end = result.start + result.removed.length;
    const delta = result.inserted.length - result.removed.length;
    const file = points.get(proposal.file) ?? [];
    for (const point of file) {
      if (point.at >= end) point.at += delta;
      else if (point.at > result.start) point.at = result.start;
    }
    file.push({
      applied: {
        id: proposal.id,
        file: proposal.file,
        class: proposal.class,
        removed: result.removed,
        inserted: result.inserted,
      },
      at: result.start,
    });
    points.set(proposal.file, file);
    texts.set(proposal.file, result.text);
    edited.add(proposal.file);
  }

  const applied: Applied[] = [];
  const order = new Map(proposals.map((proposal, index) => [proposal.id, index]));
  for (const file of edited) {
    const text = texts.get(file) ?? "";
    for (const { applied: row, at } of points.get(file) ?? []) {
      applied.push({
        ...row,
        before: text.slice(Math.max(0, at - CONTEXT), at),
        after: text.slice(at + row.inserted.length, at + row.inserted.length + CONTEXT),
      });
    }
  }
  await writeFiles(root, edited, texts);
  applied.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { applied, unlocated };
}

export interface RevertResult {
  reverted: string[];
  failed: { id: string; why: string }[];
}

/** Restores the rejected edits, latest first so neighboring edits anchor on settled text. */
export async function revertEdits(
  root: string,
  applied: readonly Applied[],
  ids: readonly string[],
): Promise<RevertResult> {
  const result: RevertResult = { reverted: [], failed: [] };
  const known = new Set(applied.map((row) => row.id));
  for (const id of ids) {
    if (!known.has(id)) result.failed.push({ id, why: "not an applied proposal" });
  }
  const targets = applied.filter((row) => ids.includes(row.id)).toReversed();
  const texts = await readFiles(
    root,
    targets.map((row) => row.file),
  );
  const changed = new Set<string>();
  for (const row of targets) {
    const restored = unedit(texts.get(row.file) ?? "", row);
    if (restored === undefined) {
      result.failed.push({ id: row.id, why: "edit not found in the file" });
      continue;
    }
    texts.set(row.file, restored);
    changed.add(row.file);
    result.reverted.push(row.id);
  }
  await writeFiles(root, changed, texts);
  return result;
}

export interface Verdict {
  id: string;
  class: Applied["class"];
  file: string;
  accepted: boolean;
  reason: string;
}

/** A proposal is accepted once its quote is gone from the commit, however the span was edited. */
export async function reconcile(
  root: string,
  commit: string,
  applied: readonly Applied[],
  proposals: readonly Proposal[],
  rejections: readonly Rejection[],
): Promise<Verdict[]> {
  const quotes = new Map(proposals.map((proposal) => [proposal.id, proposal.quote]));
  const reasons = new Map(rejections.map((rejection) => [rejection.id, rejection.reason]));
  const files = [...new Set(applied.map((row) => row.file))];
  const shown = await Promise.all(
    files.map((file) => git(root, ["show", `${commit}:${file}`]).catch(() => "")),
  );
  const contents = new Map(files.map((file, i) => [file, shown[i] ?? ""]));
  return applied.map((row) => {
    const quote = quotes.get(row.id) ?? "";
    const accepted = quote === "" || !(contents.get(row.file) ?? "").includes(quote);
    return {
      id: row.id,
      class: row.class,
      file: row.file,
      accepted,
      reason: accepted ? "" : (reasons.get(row.id) ?? ""),
    };
  });
}

const rate = (part: number, whole: number): string =>
  whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;

export function classTable(verdicts: readonly Verdict[]): string {
  const rows = CLASSES.flatMap((name) => {
    const proposed = verdicts.filter((verdict) => verdict.class === name);
    if (proposed.length === 0) return [];
    const accepted = proposed.filter((verdict) => verdict.accepted).length;
    return [[name, String(proposed.length), String(accepted), rate(accepted, proposed.length)]];
  });
  const total = verdicts.filter((verdict) => verdict.accepted).length;
  return table([
    ["class", "proposed", "accepted", "rate"],
    ...rows,
    ["total", String(verdicts.length), String(total), rate(total, verdicts.length)],
  ]);
}

export function eventsRoot(env: Env = process.env): string {
  const override = env[EVENTS_DIR_VAR];
  if (override !== undefined && override !== "") return override;
  const config = env.CLAUDE_CONFIG_DIR;
  const base = config !== undefined && config !== "" ? config : join(homedir(), ".claude");
  return join(base, "mod-events");
}

function sessionOf(env: Env): string | undefined {
  const id = env.CLAUDE_CODE_SESSION_ID;
  return id !== undefined && /^[\w-]+$/.test(id) ? id : undefined;
}

export interface AuditEvent {
  event: "proposal" | "verdict";
  detail: Record<string, unknown>;
}

export function eventRecord(
  event: AuditEvent,
  at: Date,
  sessionId?: string,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = { ...event.detail };
  if (sessionId !== undefined) attributes["session.id"] = sessionId;
  return {
    timestamp: at.toISOString(),
    severity_text: "INFO",
    severity_number: 9,
    event_name: `prompting-audit.${event.event}`,
    attributes,
    resource: { "service.name": "claude-code" },
    scope: { name: "prompting-audit" },
  };
}

// Skipped under `bun test` unless the events directory is overridden, so fixture rounds
// never land in the live log.
export async function emit(events: readonly AuditEvent[], env: Env = process.env): Promise<void> {
  const overridden = (env[EVENTS_DIR_VAR] ?? "") !== "";
  if (env.NODE_ENV === "test" && !overridden) return;
  if (events.length === 0) return;
  const at = new Date();
  const sessionId = sessionOf(env);
  const dir = join(eventsRoot(env), sessionId ?? "cli");
  try {
    await mkdir(dir, { recursive: true });
    const lines = events.map((event) => `${JSON.stringify(eventRecord(event, at, sessionId))}\n`);
    const name = `prompting-audit.${at.toISOString().slice(0, 10)}.jsonl`;
    await appendFile(join(dir, name), lines.join(""));
  } catch (error) {
    console.error(`prompting-audit: events not recorded: ${String(error)}`);
  }
}

const SKILL_DIR = /^((?:.*\/)?skills\/[^/]+)\/references\//;
const EXCLUDED = /(^|\/)(node_modules|fixtures|__snapshots__)\//;

/**
 * Agent-facing files under `paths`, grouped into judge units. A skill directory is one unit
 * and any other file is its own.
 */
export async function units(paths: readonly string[], cwd = process.cwd()): Promise<Unit[]> {
  const listed = await git(cwd, ["ls-files", "-co", "--exclude-standard", "-z", "--", ...paths]);
  const glob = new Bun.Glob(AGENT_FACING);
  const files = [...new Set(listed.split("\0"))]
    .filter((file) => file !== "" && glob.match(file) && !EXCLUDED.test(file))
    .toSorted();
  const present = await Promise.all(files.map((file) => Bun.file(join(cwd, file)).exists()));
  const grouped = new Map<string, string[]>();
  for (const file of files.filter((_, i) => present[i])) {
    const unit =
      basename(file) === "SKILL.md" ? dirname(file) : (SKILL_DIR.exec(file)?.[1] ?? file);
    grouped.set(unit, [...(grouped.get(unit) ?? []), file]);
  }
  return [...grouped].map(([unit, members]) => ({ unit, files: members }));
}

const unitsCommand = new Command("units")
  .description("List the judge units among agent-facing files.")
  .argument("[path...]", "files or directories to search", [])
  .option("--json", "print the units as JSON")
  .action(async (paths, options) => {
    const found = await units(paths.length > 0 ? paths : ["."]);
    if (options.json === true) {
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    for (const { unit, files } of found) console.log([unit, ...files].join("\t"));
  });

const applyCommand = new Command("apply")
  .description("Apply each proposal in the ledger to the working tree.")
  .argument("<ledger>", "proposals.jsonl")
  .action(async (ledger) => {
    const paths = siblings(ledger);
    if (await Bun.file(paths.applied).exists()) {
      throw new Error(`${paths.applied} exists: this ledger was already applied.`);
    }
    const root = await toplevel(process.cwd());
    const proposals = await readJsonl(ledger, Proposal);
    const { applied, unlocated } = await applyProposals(root, proposals);
    await writeJsonl(paths.applied, applied);
    const repo = await repoName(root);
    const run = runOf(ledger);
    await emit(
      applied.map((row) => ({
        event: "proposal",
        detail: { run, id: row.id, class: row.class, file: row.file, repo },
      })),
    );
    console.log(`applied ${applied.length} of ${proposals.length} proposals`);
    for (const miss of unlocated) {
      console.log(`unlocated: ${miss.id} (${miss.file}): ${miss.why}`);
    }
  });

const revertCommand = new Command("revert")
  .description("Restore rejected proposals and record why.")
  .argument("<ledger>", "proposals.jsonl")
  .argument("<id...>", "proposals to restore")
  .option("--reason <text>", "why the reviewer rejected them, applied to every id given", "")
  .action(async (ledger, ids, options) => {
    const paths = siblings(ledger);
    const root = await toplevel(process.cwd());
    const applied = await readJsonl(paths.applied, Applied);
    const prior = await readOptionalJsonl(paths.rejections, Rejection);
    const done = new Set(prior.filter((row) => row.reverted).map((row) => row.id));
    for (const skipped of ids.filter((candidate) => done.has(candidate))) {
      console.log(`already reverted: ${skipped}`);
    }

    const pending = ids.filter((candidate) => !done.has(candidate));
    const result = await revertEdits(root, applied, pending);
    const known = new Set(applied.map((row) => row.id));
    const merged = new Map(prior.map((row) => [row.id, row]));
    for (const rejected of pending.filter((candidate) => known.has(candidate))) {
      merged.set(rejected, {
        id: rejected,
        reason: options.reason,
        reverted: result.reverted.includes(rejected),
      });
    }
    await writeJsonl(paths.rejections, [...merged.values()]);
    for (const id of result.reverted) console.log(`reverted: ${id}`);
    for (const miss of result.failed) console.log(`failed: ${miss.id}: ${miss.why}`);
    if (result.failed.length > 0) process.exitCode = 1;
  });

const verdictCommand = new Command("verdict")
  .description("Reconcile the round against a commit and record the verdicts.")
  .argument("<ledger>", "proposals.jsonl")
  .requiredOption("--commit <sha>", "commit holding the reviewed changes")
  .action(async (ledger, options) => {
    const paths = siblings(ledger);
    const root = await toplevel(process.cwd());
    const proposals = await readJsonl(ledger, Proposal);
    const applied = await readJsonl(paths.applied, Applied);
    const rejections = await readOptionalJsonl(paths.rejections, Rejection);
    const commit = (
      await git(root, ["rev-parse", "--verify", `${options.commit}^{commit}`])
    ).trim();
    const short = (await git(root, ["rev-parse", "--short", commit])).trim();
    const verdicts = await reconcile(root, commit, applied, proposals, rejections);
    const run = runOf(ledger);
    await emit(
      verdicts.map((verdict) => ({
        event: "verdict",
        detail: {
          run,
          id: verdict.id,
          class: verdict.class,
          accepted: verdict.accepted,
          commit,
          reason: verdict.reason,
        },
      })),
    );
    console.log(classTable(verdicts));
    console.log("Add to plugins/prompting/evals/rule-precision/labels.json:");
    console.log(`"agent": [..., "${short}"]`);
  });

export const program = new Command("audit")
  .description("One round of the prompt prune loop: apply proposals, revert rejections, reconcile.")
  .addCommand(unitsCommand)
  .addCommand(applyCommand)
  .addCommand(revertCommand)
  .addCommand(verdictCommand);

if (import.meta.main) {
  await program.parseAsync();
}
