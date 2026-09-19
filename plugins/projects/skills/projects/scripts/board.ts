#!/usr/bin/env bun
import { cancel, intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { cli } from "cleye";
import { getBorderCharacters, table } from "table";
import { liveAgents } from "./capture";
import { type CommandResult, type Runner, spawnRunner } from "./dispatch";
import { leadName, readProjects } from "./projects";
import { buildStatus, formatAge, type ProjectStatus, type Status } from "./status";
import { type DispatchLedgerRow, readLedger, resolveDataDir } from "./threads";

const TRUNCATE = 120;
const INTERVAL_SECONDS = 10;

const BOLD = "1";
const CYAN = "36";
const YELLOW = "33";

export interface ProjectGroup {
  slug: string;
  description: string;
  threads: DispatchLedgerRow[];
}

export interface WorkspaceGroup {
  workspace: string;
  projects: ProjectGroup[];
  threads: DispatchLedgerRow[];
}

// Every order is first-seen, which is dispatch order.
export function groupThreads(status: Status): WorkspaceGroup[] {
  const descriptions = new Map(
    status.projects.map((project) => [project.slug, project.description]),
  );
  const workspaces = new Map<string, WorkspaceGroup>();
  for (const row of status.threads) {
    let workspace = workspaces.get(row.workspace);
    if (workspace == null) {
      workspace = { workspace: row.workspace, projects: [], threads: [] };
      workspaces.set(row.workspace, workspace);
    }
    const slug = row.tags?.project;
    if (slug == null) {
      workspace.threads.push(row);
      continue;
    }
    let project = workspace.projects.find((entry) => entry.slug === slug);
    if (project == null) {
      project = { slug, description: descriptions.get(slug) ?? "", threads: [] };
      workspace.projects.push(project);
    }
    project.threads.push(row);
  }
  return [...workspaces.values()];
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

// Every value here is written straight to a terminal, so escape and format
// bytes go before the whitespace does. A newline additionally makes table()
// emit more lines than it was given rows, which slides every later row under
// the wrong header.
function oneLine(value: string): string {
  return value
    .replaceAll(/[\p{Cc}\p{Cf}]/gu, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function cell(value: string | null | undefined): string {
  const collapsed = value == null ? "" : oneLine(value);
  return collapsed === "" ? "-" : collapsed;
}

function threadCells(row: DispatchLedgerRow, now: Date, indent = ""): string[] {
  return [
    `${indent}${oneLine(row.branch)}`,
    row.outcome,
    cell(row.agent),
    formatAge(row.ts, now),
    cell(row.pr),
  ];
}

// Headers and thread rows interleave, so the rows go through one table per
// workspace for alignment and the headers are spliced back into the result.
function section(group: WorkspaceGroup, now: Date): Line[] {
  const entries: ({ header: Line } | { cells: string[] })[] = [
    { header: { text: oneLine(group.workspace), style: BOLD } },
  ];
  for (const project of group.projects) {
    entries.push({
      header: {
        text: `  ${oneLine(project.slug)}  ${oneLine(project.description)}`.trimEnd(),
        style: CYAN,
      },
    });
    for (const row of project.threads) entries.push({ cells: threadCells(row, now, "    ") });
  }
  for (const row of group.threads) entries.push({ cells: threadCells(row, now, "  ") });
  const rendered = plain(entries.flatMap((entry) => ("cells" in entry ? [entry.cells] : [])));
  let index = 0;
  return entries.map((entry) =>
    "header" in entry ? entry.header : { text: rendered[index++] ?? "" },
  );
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
  const lines: Line[] = [];
  for (const group of groupThreads(status)) {
    if (lines.length > 0) lines.push({ text: "" });
    lines.push(...section(group, now));
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
  | { kind: "thread"; row: DispatchLedgerRow };

// A null live set means herdr could not answer, so every name stays targetable
// and herdr reports the failure itself.
export function targetAgent(
  target: Target,
  live: ReadonlySet<string> | null = null,
): string | null {
  const name =
    target.kind === "thread"
      ? target.row.agent
      : target.project.lead === "none"
        ? null
        : leadName(target.project.slug);
  if (name == null) return null;
  return live == null || live.has(name) ? name : null;
}

function targetLabel(target: Target): string {
  return oneLine(target.kind === "project" ? target.project.slug : target.row.branch);
}

export interface Choice {
  target: Target;
  label: string;
}

export function choices(status: Status, now: Date, truncate = TRUNCATE): Choice[] {
  const threads: DispatchLedgerRow[] = [];
  for (const group of groupThreads(status)) {
    for (const project of group.projects) threads.push(...project.threads);
    threads.push(...group.threads);
  }
  const projectLines = plain(
    status.projects.map((project) => [
      oneLine(project.slug),
      oneLine(project.description),
      `lead:${project.lead}`,
      `open:${project.open}`,
    ]),
  );
  const threadLines = plain(threads.map((row) => threadCells(row, now)));
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
  live: ReadonlySet<string> | null;
  warnings: string[];
}

export async function loadStatus(dataDir: string): Promise<BoardData> {
  const warnings: string[] = [];
  const warn = (warning: string): void => {
    warnings.push(warning);
  };
  const [projects, rows, live] = await Promise.all([
    readProjects(dataDir, warn),
    readLedger(dataDir, warn),
    liveAgents(),
  ]);
  return { status: buildStatus(projects, rows, {}, live), live, warnings };
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
    try {
      const { status, warnings } = await loadStatus(dataDir);
      board = formatBoard(status, new Date(), { truncate, color: true, warnings });
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
    try {
      data = await loadStatus(dataDir);
    } catch (error) {
      cancel(reason(error));
      process.exitCode = 1;
      return;
    }
    for (const warning of data.warnings) log.warn(oneLine(warning));
    const options = choices(data.status, new Date(), truncate);
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
    const agent = targetAgent(choice.target, data.live);
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
