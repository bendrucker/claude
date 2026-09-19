#!/usr/bin/env bun
import { basename } from "node:path";
import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { cli } from "cleye";
import { getBorderCharacters, table } from "table";
import { type Agents, listAgents, readPullRequests } from "./capture";
import { type CommandResult, type Runner, spawnRunner } from "./dispatch";
import {
  answerItem,
  BEN,
  clearItem,
  openItems,
  type QueueItem,
  readQueue,
  resolveLanded,
} from "./items";
import { leadName, readProjects } from "./projects";
import {
  buildStatus,
  formatAge,
  itemCells,
  type Need,
  NEEDS,
  oneLine,
  type ProjectStatus,
  type Status,
  type Thread,
} from "./status";
import { latestRows, readLedger, resolveDataDir } from "./threads";

const TRUNCATE = 120;
const INTERVAL_SECONDS = 10;

const BOLD = "1";
const YELLOW = "33";

// The items Ben was asked for directly, with the threads the board inferred he
// is holding up kept beneath them.
const NEEDS_YOU = "NEEDS YOU";
const OBSERVED = "observed";

export interface NeedGroup {
  need: Need;
  threads: Thread[];
}

// Groups follow the display order of the needs, threads inside one follow
// first-seen order, which is dispatch order.
export function groupThreads(status: Status): NeedGroup[] {
  const groups = new Map<Need, NeedGroup>();
  for (const row of status.threads) {
    let group = groups.get(row.need);
    if (group == null) {
      group = { need: row.need, threads: [] };
      groups.set(row.need, group);
    }
    group.threads.push(row);
  }
  return NEEDS.flatMap((need) => groups.get(need) ?? []);
}

interface Line {
  text: string;
  style?: string;
}

function plain(rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) return [];
  return table(
    rows.map((row) => [...row]),
    {
      border: getBorderCharacters("void"),
      columnDefault: { paddingLeft: 0, paddingRight: 2 },
      drawHorizontalLine: () => false,
    },
  )
    .split("\n")
    .map((line) => line.trimEnd())
    .slice(0, rows.length);
}

// A trailing empty cell disappears once the line is trimmed, so a thread with
// no note costs nothing.
function optional(value: string | null | undefined): string {
  return value == null ? "" : oneLine(value);
}

function cell(value: string | null | undefined): string {
  const collapsed = optional(value);
  return collapsed === "" ? "-" : collapsed;
}

// Grouping by need drops the workspace headings, which leaves an untagged
// thread silent about the checkout it came from. Its repository is the same
// kind of identity a project slug is, and fits the same cell.
function origin(row: Thread): string {
  return row.tags?.project ?? basename(row.repo);
}

function threadCells(row: Thread, now: Date, indent = ""): string[] {
  return [
    `${indent}${cell(origin(row))}`,
    oneLine(row.branch),
    row.outcome,
    cell(row.agent),
    formatAge(row.ts, now),
    cell(row.pr),
    optional(row.note),
  ];
}

function clip(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

function paint(value: string, style: string | undefined): string {
  return style == null || value === "" ? value : `[${style}m${value}[0m`;
}

export interface BoardOptions {
  truncate?: number;
  color?: boolean;
  warnings?: readonly string[];
}

export function formatBoard(status: Status, now: Date, options: BoardOptions = {}): string {
  const truncate = options.truncate ?? TRUNCATE;
  const groups = groupThreads(status);
  const waiting = groups.find((group) => group.need === "waiting-on-you")?.threads ?? [];
  const rest = groups.filter((group) => group.need !== "waiting-on-you");
  const items = plain(status.queue.map((item) => itemCells(item, now, "  ")));
  // One table across every group keeps the columns aligned down the board.
  const rendered = plain([
    ...waiting.map((row) => threadCells(row, now, "    ")),
    ...rest.flatMap((group) => group.threads.map((row) => threadCells(row, now, "  "))),
  ]);
  const lines: Line[] = [];
  let next = 0;
  if (status.queue.length > 0 || waiting.length > 0) {
    lines.push({ text: NEEDS_YOU, style: BOLD });
    lines.push(...items.map((item) => ({ text: item })));
    if (waiting.length > 0) {
      lines.push({ text: `  ${OBSERVED}` });
      lines.push(...waiting.map(() => ({ text: rendered[next++] ?? "" })));
    }
  }
  for (const group of rest) {
    if (lines.length > 0) lines.push({ text: "" });
    lines.push({ text: group.need, style: BOLD });
    lines.push(...group.threads.map(() => ({ text: rendered[next++] ?? "" })));
  }
  if (lines.length === 0) lines.push({ text: "no open threads" });
  // Warnings go in the board because watch mode clears the screen over stderr.
  for (const [index, warning] of (options.warnings ?? []).entries()) {
    if (index === 0) lines.push({ text: "" });
    lines.push({ text: oneLine(warning), style: YELLOW });
  }
  return `${lines
    .map((line) =>
      paint(clip(line.text, truncate), options.color === true ? line.style : undefined),
    )
    .join("\n")}\n`;
}

export type Target =
  | { kind: "project"; project: ProjectStatus }
  | { kind: "thread"; row: Thread }
  | { kind: "item"; item: QueueItem };

// A name herdr no longer lists falls back to the pane the row recorded, which
// every agent command takes, unless herdr reports that pane under another name:
// a focus or a prompt meant for this target must never reach whoever took the
// pane over.
function liveTarget(
  name: string | null,
  pane: string | null,
  agents: Agents | null,
): string | null {
  if (name != null && (agents == null || agents.names.has(name))) return name;
  if (pane == null) return null;
  const occupant = agents?.panes.get(pane);
  return occupant != null && occupant.name !== name ? null : pane;
}

// A null listing means herdr could not answer, so every name stays targetable
// and herdr reports the failure itself.
export function targetAgent(target: Target, agents: Agents | null = null): string | null {
  if (target.kind === "thread") return liveTarget(target.row.agent, target.row.pane, agents);
  if (target.kind === "item")
    return liveTarget(target.item.agent ?? null, target.item.pane ?? null, agents);
  if (target.project.lead === "none") return null;
  const name = leadName(target.project.slug);
  return agents == null || agents.names.has(name) ? name : null;
}

function targetLabel(target: Target): string {
  if (target.kind === "project") return oneLine(target.project.slug);
  return oneLine(target.kind === "item" ? target.item.id : target.row.branch);
}

export interface Choice {
  target: Target;
  label: string;
}

export function choices(status: Status, now: Date, truncate = TRUNCATE): Choice[] {
  const threads = groupThreads(status).flatMap((group) => group.threads);
  const itemLines = plain(status.queue.map((item) => itemCells(item, now)));
  const projectLines = plain(
    status.projects.map((project) => [
      oneLine(project.slug),
      oneLine(project.description),
      `lead:${project.lead}`,
      `open:${project.open}`,
    ]),
  );
  // The picker is one flat list, so each row carries the need the board would
  // have put in a heading above it.
  const threadLines = plain(threads.map((row) => [row.need, ...threadCells(row, now)]));
  const label = (lines: string[], index: number): string => clip(lines[index] ?? "", truncate);
  // The queue leads, because an item is Ben's to clear before anything the
  // board worked out for itself.
  const picked: Choice[] = status.queue.map((item, index) => ({
    target: { kind: "item", item },
    label: label(itemLines, index),
  }));
  for (const [index, project] of status.projects.entries())
    picked.push({ target: { kind: "project", project }, label: label(projectLines, index) });
  for (const [index, row] of threads.entries())
    picked.push({ target: { kind: "thread", row }, label: label(threadLines, index) });
  return picked;
}

export function focus(target: string, run: Runner = spawnRunner): Promise<CommandResult> {
  return run(["herdr", "agent", "focus", target]);
}

export function message(
  target: string,
  body: string,
  run: Runner = spawnRunner,
): Promise<CommandResult> {
  return run(["herdr", "agent", "prompt", target, body]);
}

export interface BoardData {
  status: Status;
  agents: Agents | null;
  warnings: string[];
}

export async function loadStatus(dataDir: string, now: Date = new Date()): Promise<BoardData> {
  const warnings: string[] = [];
  const warn = (warning: string): void => {
    warnings.push(warning);
  };
  const [projects, rows] = await Promise.all([
    readProjects(dataDir, warn),
    readLedger(dataDir, warn),
  ]);
  const [agents, pullRequests, queue] = await Promise.all([
    listAgents(),
    readPullRequests(latestRows(rows), now),
    resolveLanded(openItems(readQueue(dataDir, warn)), dataDir),
  ]);
  return {
    status: buildStatus(projects, rows, {}, { agents, pullRequests, now }, queue),
    agents,
    warnings,
  };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// cleye yields null rather than NaN for a value it cannot read as a number.
function positive(value: number, flag: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    process.stderr.write(`board: --${flag} takes a positive number\n`);
    process.exit(2);
  }
  return value;
}

// oxlint-disable no-await-in-loop -- a board render and the wait after it are sequential by nature, as is one prompt after another.
// A failed read costs one render rather than the whole split.
async function watch(dataDir: string, intervalMs: number, truncate: number): Promise<void> {
  for (;;) {
    let board: string;
    const now = new Date();
    try {
      const { status, warnings } = await loadStatus(dataDir, now);
      board = formatBoard(status, now, { truncate, color: true, warnings });
    } catch (error) {
      board = `${clip(oneLine(reason(error)), truncate)}\n`;
    }
    process.stdout.write(`[2J[H${board}`);
    await Bun.sleep(intervalMs);
  }
}

function report(result: CommandResult, done: string): void {
  if (result.code === 0) {
    outro(done);
    return;
  }
  log.error(result.stderr.trim() === "" ? `herdr exited ${result.code}` : result.stderr.trim());
  outro("failed");
  process.exitCode = 1;
}

// An item is Ben's to clear, so the actions on one write the queue rather than
// reaching for the agent.
async function actOnItem(
  item: QueueItem,
  agent: string | null,
  dataDir: string,
  run: Runner,
): Promise<void> {
  const action = await select({
    message: item.id,
    options: [
      { value: "ack", label: "Acknowledge" },
      { value: "answer", label: "Answer" },
      ...(agent == null ? [] : [{ value: "focus", label: "Focus the pane" }]),
    ],
  });
  if (isCancel(action)) {
    cancel("nothing sent");
    return;
  }
  if (action === "focus" && agent != null) {
    report(await focus(agent, run), `focus ${agent}`);
    return;
  }
  try {
    if (action === "ack") {
      clearItem({ id: item.id, state: "acked", by: BEN }, dataDir);
      outro(`acked ${item.id}`);
      return;
    }
    const body = await text({
      message: `Answer ${item.id}`,
      validate: (value) => (value.trim() === "" ? "An answer cannot be empty" : undefined),
    });
    if (isCancel(body)) {
      cancel("nothing sent");
      return;
    }
    const answered = await answerItem(item.id, body, BEN, dataDir, run);
    outro(
      answered.delivered === true
        ? `answered ${item.id}, delivered to ${answered.agent}`
        : `answered ${item.id}`,
    );
  } catch (error) {
    log.error(reason(error));
    outro("failed");
    process.exitCode = 1;
  }
}

async function interactive(dataDir: string, truncate: number, run: Runner): Promise<void> {
  intro("herdr board");
  for (;;) {
    let data: BoardData;
    const now = new Date();
    try {
      data = await loadStatus(dataDir, now);
    } catch (error) {
      cancel(reason(error));
      process.exitCode = 1;
      return;
    }
    for (const warning of data.warnings) log.warn(oneLine(warning));
    const options = choices(data.status, now, truncate);
    if (options.length === 0) {
      outro("no projects or open threads");
      return;
    }
    const picked = await select({
      message: "Target",
      options: options.map((choice, index) => ({ value: String(index), label: choice.label })),
    });
    if (isCancel(picked)) {
      cancel("nothing sent");
      return;
    }
    const choice = options[Number(picked)];
    if (choice == null) return;
    const agent = targetAgent(choice.target, data.agents);
    if (choice.target.kind === "item") {
      await actOnItem(choice.target.item, agent, dataDir, run);
      return;
    }
    if (agent == null) {
      log.warn(`${targetLabel(choice.target)} has no live agent`);
      continue;
    }
    const action = await select({
      message: agent,
      options: [
        { value: "focus", label: "Focus the pane" },
        { value: "message", label: "Send a message" },
      ],
    });
    if (isCancel(action)) {
      cancel("nothing sent");
      return;
    }
    if (action === "focus") {
      report(await focus(agent, run), `focus ${agent}`);
      return;
    }
    const body = await text({
      message: `Message ${agent}`,
      validate: (value) => (value.trim() === "" ? "A message cannot be empty" : undefined),
    });
    if (isCancel(body)) {
      cancel("nothing sent");
      return;
    }
    report(await message(agent, body, run), `message ${agent}`);
    return;
  }
}
// oxlint-enable no-await-in-loop

if (import.meta.main) {
  const argv = cli({
    name: "board",
    help: {
      description: "Show the dispatch ledger as a board, or drive an agent from it.",
    },
    flags: {
      watch: { type: Boolean, description: "Re-render on an interval instead of prompting" },
      interval: {
        type: Number,
        default: INTERVAL_SECONDS,
        description: "Seconds between watch renders",
      },
      truncate: { type: Number, default: TRUNCATE, description: "Maximum line width" },
      dataDir: { type: String, description: "Ledger directory; defaults to the plugin data dir" },
    },
  });

  const dataDir = resolveDataDir(argv.flags.dataDir);
  const truncate = positive(argv.flags.truncate, "truncate");
  if (argv.flags.watch) {
    await watch(dataDir, positive(argv.flags.interval, "interval") * 1000, truncate);
  } else await interactive(dataDir, truncate, spawnRunner);
}
