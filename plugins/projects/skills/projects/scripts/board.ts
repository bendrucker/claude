#!/usr/bin/env bun
import { basename } from "node:path";
import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { cli } from "cleye";
import { getBorderCharacters, table } from "table";
import { type Agents, listAgents, readPullRequests } from "./capture";
import { type CommandResult, type Runner, spawnRunner } from "./dispatch";
import { leadName, readProjects } from "./projects";
import {
  buildStatus,
  formatAge,
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
  // One table across every group keeps the columns aligned down the board.
  const rendered = plain(
    groups.flatMap((group) => group.threads.map((row) => threadCells(row, now, "  "))),
  );
  const lines: Line[] = [];
  let next = 0;
  for (const group of groups) {
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

export type Target = { kind: "project"; project: ProjectStatus } | { kind: "thread"; row: Thread };

// A null listing means herdr could not answer, so every name stays targetable
// and herdr reports the failure itself. A thread whose name is gone falls back
// to the pane the ledger recorded, which every agent command takes, unless
// herdr reports that pane under another name: a focus or a prompt meant for
// this thread must never reach whoever took the pane over.
export function targetAgent(target: Target, agents: Agents | null = null): string | null {
  if (target.kind === "thread") {
    const name = target.row.agent;
    if (name != null && (agents == null || agents.names.has(name))) return name;
    const occupant = agents?.panes.get(target.row.pane);
    return occupant != null && occupant.name !== name ? null : target.row.pane;
  }
  if (target.project.lead === "none") return null;
  const name = leadName(target.project.slug);
  return agents == null || agents.names.has(name) ? name : null;
}

function targetLabel(target: Target): string {
  return oneLine(target.kind === "project" ? target.project.slug : target.row.branch);
}

export interface Choice {
  target: Target;
  label: string;
}

export function choices(status: Status, now: Date, truncate = TRUNCATE): Choice[] {
  const threads = groupThreads(status).flatMap((group) => group.threads);
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
  const picked: Choice[] = status.projects.map((project, index) => ({
    target: { kind: "project", project },
    label: label(projectLines, index),
  }));
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
  const [agents, pullRequests] = await Promise.all([
    listAgents(),
    readPullRequests(latestRows(rows), now),
  ]);
  return {
    status: buildStatus(projects, rows, {}, { agents, pullRequests, now }),
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
    let result: CommandResult;
    if (action === "focus") result = await focus(agent, run);
    else {
      const body = await text({
        message: `Message ${agent}`,
        validate: (value) => (value.trim() === "" ? "A message cannot be empty" : undefined),
      });
      if (isCancel(body)) {
        cancel("nothing sent");
        return;
      }
      result = await message(agent, body, run);
    }
    if (result.code === 0) outro(`${action} ${agent}`);
    else {
      log.error(result.stderr.trim() === "" ? `herdr exited ${result.code}` : result.stderr.trim());
      outro("failed");
      process.exitCode = 1;
    }
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
