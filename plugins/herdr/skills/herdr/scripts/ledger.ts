#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: appends the dispatch ledger in the plugin data dir under ~/.claude/plugins
// concurrent dispatches append to one ledger, so writes need O_APPEND atomicity. Bun.write read-modify-write would drop lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cli, command } from "cleye";
import { getBorderCharacters, table } from "table";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Only dispatch writes the first two; `outcome` records how a thread came back.
export const CLOSING = ["done", "blocked", "abandoned"] as const;
export type Closing = (typeof CLOSING)[number];
export const OUTCOMES = ["dispatched", "orphaned", ...CLOSING] as const;
export type Outcome = (typeof OUTCOMES)[number];

// A thread stays on the board while someone still owes it a result.
const OPEN: ReadonlySet<Outcome> = new Set(["dispatched", "blocked"]);

const TAG_KEY = /^[a-z][a-z0-9_-]*$/;
// herdr agent names are `^[a-z][a-z0-9_-]{0,31}$`, and `lead-` takes five of those.
const LEAD_SLUG = /^[a-z][a-z0-9_-]{0,26}$/;

// One line per dispatch, written as soon as the worktree exists, so a later
// session can see what was handed out and to which agent. A dispatch that
// failed after that point leaves a checkout nobody owns, which is the case
// cleanup most needs, so `orphaned` rows carry the path with a null agent.
// Later rows for the same repo and branch carry the thread's outcome, and the
// latest row is its state.
export const LedgerRow = z.object({
  ts: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string(),
  path: z.string(),
  workspace: z.string(),
  pane: z.string(),
  agent: z.string().nullable(),
  session: z.string().nullable(),
  outcome: z.enum(OUTCOMES),
  tags: z.record(z.string(), z.string()).optional(),
  pr: z.string().optional(),
  note: z.string().optional(),
});
export type DispatchLedgerRow = z.infer<typeof LedgerRow>;

const Frontmatter = z.looseObject({
  name: z.string(),
  description: z.string(),
  repo: z.string().optional(),
  tracker: z.string().optional(),
  lead: z.string().optional(),
});

export interface Project extends z.infer<typeof Frontmatter> {
  slug: string;
}

export type LeadState = "live" | "none" | "unknown";

export interface ProjectStatus extends Project {
  lead: LeadState;
  open: number;
}

export interface Status {
  projects: ProjectStatus[];
  threads: DispatchLedgerRow[];
}

// A cached plugin's imports stay inside its own directory, so each plugin
// resolves its own data dir.
export function resolveDataDir(override?: string): string {
  if (override != null && override !== "") return override;
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;
  return join(homedir(), ".claude", "plugins", "data", "herdr-bendrucker");
}

export function ledgerPath(dataDir: string): string {
  return join(dataDir, "dispatches.jsonl");
}

export function projectsDir(dataDir: string): string {
  return join(dataDir, "projects");
}

export function appendDispatch(row: DispatchLedgerRow, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(row)}\n`);
}

// The key is constrained so a tag can be a filter argument and a column header without escaping.
export function parseTags(values: readonly string[]): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const value of values) {
    const at = value.indexOf("=");
    const key = at === -1 ? value : value.slice(0, at);
    if (at === -1 || !TAG_KEY.test(key) || value.length === at + 1)
      throw new Error(`tag "${value}" must be <key>=<value> with a key matching ${TAG_KEY}`);
    tags[key] = value.slice(at + 1);
  }
  return tags;
}

export function formatTags(tags: Record<string, string> | undefined): string {
  return Object.entries(tags ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

// A line that fails to parse is reported and skipped rather than failing the
// read: the ledger is reprinted at every compaction, and one bad line must not
// hide every good one.
export async function readLedger(
  dataDir: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<DispatchLedgerRow[]> {
  const file = Bun.file(ledgerPath(dataDir));
  if (!(await file.exists())) return [];
  const rows: DispatchLedgerRow[] = [];
  const lines = (await file.text()).split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warn(`${ledgerPath(dataDir)}:${index + 1}: not JSON, skipped`);
      continue;
    }
    const result = LedgerRow.safeParse(parsed);
    if (result.success) rows.push(result.data);
    else {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      warn(`${ledgerPath(dataDir)}:${index + 1}: ${issues.join("; ")}, skipped`);
    }
  }
  return rows;
}

function threadKey(row: Pick<DispatchLedgerRow, "repo" | "branch">): string {
  return `${row.repo}\0${row.branch}`;
}

// The latest row per thread, in the order the threads first appeared.
export function latestRows(rows: readonly DispatchLedgerRow[]): DispatchLedgerRow[] {
  const latest = new Map<string, DispatchLedgerRow>();
  for (const row of rows) latest.set(threadKey(row), row);
  return [...latest.values()];
}

export function hasTags(row: DispatchLedgerRow, tags: Record<string, string>): boolean {
  return Object.entries(tags).every(([key, value]) => row.tags?.[key] === value);
}

export function openThreads(
  rows: readonly DispatchLedgerRow[],
  tags: Record<string, string> = {},
): DispatchLedgerRow[] {
  return latestRows(rows).filter((row) => OPEN.has(row.outcome) && hasTags(row, tags));
}

export interface OutcomeInput {
  repo: string;
  branch: string;
  state: Closing;
  pr?: string | undefined;
  note?: string | undefined;
}

// The outcome row copies the thread's identifiers from its latest row, so
// every row stands alone and folding needs no join. The note explains one
// state, so it does not carry over to the next.
export async function appendOutcome(
  input: OutcomeInput,
  dataDir: string,
  now: () => Date = () => new Date(),
): Promise<DispatchLedgerRow> {
  const key = threadKey(input);
  const latest = latestRows(await readLedger(dataDir)).find((row) => threadKey(row) === key);
  if (latest == null)
    throw new Error(`no dispatch of ${input.branch} in ${input.repo} in ${ledgerPath(dataDir)}`);
  const { note: _previous, ...carried } = latest;
  const row: DispatchLedgerRow = { ...carried, ts: now().toISOString(), outcome: input.state };
  if (input.pr != null) row.pr = input.pr;
  if (input.note != null) row.note = input.note;
  appendDispatch(row, dataDir);
  return row;
}

async function capture(argv: string[]): Promise<string | null> {
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch {
    return null;
  }
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? stdout : null;
}

// dispatch records a thread against the primary worktree, which git lists
// first, so an outcome typed from a linked worktree or a subdirectory folds
// onto the same thread. A path git does not know is returned as given.
export async function primaryRoot(repo: string): Promise<string> {
  const listing = await capture(["git", "-C", repo, "worktree", "list", "--porcelain"]);
  const root = listing
    ?.split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length)
    .trim();
  return root == null || root === "" ? repo : root;
}

// `project.md` is shaped like a skill: frontmatter carries the routing line, the
// body carries the standing instructions, and only the frontmatter is read here.
export function parseProject(slug: string, text: string): Project {
  if (!LEAD_SLUG.test(slug))
    throw new Error(`projects/${slug}: slug must match ${LEAD_SLUG} to name a lead-${slug} agent`);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match == null) throw new Error(`projects/${slug}/project.md has no frontmatter`);
  const frontmatter = Frontmatter.parse(parseYaml(match[1] ?? ""));
  return { slug, ...frontmatter };
}

export async function readProjects(
  dataDir: string,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): Promise<Project[]> {
  const root = projectsDir(dataDir);
  const projects: Project[] = [];
  if (!existsSync(root)) return projects;
  for await (const path of new Bun.Glob("*/project.md").scan({ cwd: root })) {
    const slug = path.slice(0, path.indexOf("/"));
    try {
      projects.push(parseProject(slug, await Bun.file(join(root, path)).text()));
    } catch (error) {
      warn(
        `${join(root, path)}: ${error instanceof Error ? error.message : String(error)}, skipped`,
      );
    }
  }
  return projects.toSorted((a, b) => a.slug.localeCompare(b.slug));
}

export function leadName(slug: string): string {
  return `lead-${slug}`;
}

const AgentList = z.object({
  result: z.object({ agents: z.array(z.object({ name: z.string().nullish() })) }),
});

// Null when herdr cannot answer, which is not the same as no agents.
export async function liveAgents(): Promise<ReadonlySet<string> | null> {
  const stdout = await capture(["herdr", "agent", "list"]);
  if (stdout == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const listed = AgentList.safeParse(parsed);
  if (!listed.success) return null;
  return new Set(
    listed.data.result.agents.flatMap((agent) => (agent.name == null ? [] : [agent.name])),
  );
}

export function buildStatus(
  projects: readonly Project[],
  rows: readonly DispatchLedgerRow[],
  tags: Record<string, string>,
  live: ReadonlySet<string> | null,
): Status {
  const open = latestRows(rows).filter((row) => OPEN.has(row.outcome));
  return {
    projects: projects.map((project) => ({
      ...project,
      lead: live == null ? "unknown" : live.has(leadName(project.slug)) ? "live" : "none",
      open: open.filter((row) => row.tags?.project === project.slug).length,
    })),
    threads: open.filter((row) => hasTags(row, tags)),
  };
}

export function formatAge(ts: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(ts);
  if (Number.isNaN(elapsed)) return "?";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function plain(rows: readonly (readonly string[])[]): string {
  return table(
    rows.map((row) => row.map((cell) => cell.replaceAll(/\s+/g, " ").trim())),
    {
      border: getBorderCharacters("void"),
      columnDefault: { paddingLeft: 0, paddingRight: 2 },
      drawHorizontalLine: () => false,
    },
  )
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

// Each block is one line per item, so a compaction hook can print it verbatim.
export function formatStatus(status: Status, now: Date): string {
  const projects =
    status.projects.length === 0
      ? "no projects"
      : plain(
          status.projects.map((project) => [
            project.slug,
            project.description,
            `lead:${project.lead}`,
            `open:${project.open}`,
          ]),
        );
  const threads =
    status.threads.length === 0
      ? "no open threads"
      : plain([
          ["branch", "state", "agent", "pane", "age", "pr", "tags"],
          ...status.threads.map((row) => [
            row.branch,
            row.outcome,
            row.agent ?? "-",
            row.pane,
            formatAge(row.ts, now),
            row.pr ?? "-",
            formatTags(row.tags),
          ]),
        ]);
  return `projects\n${projects}\n\nthreads\n${threads}\n`;
}

if (import.meta.main) {
  const dataDir = {
    type: String,
    description: "Ledger directory; defaults to the plugin data dir",
  };

  const outcome = command(
    {
      name: "outcome",
      help: { description: "Record a thread's outcome as a new ledger row." },
      flags: {
        repo: {
          type: String,
          default: process.cwd(),
          description: "Repository the thread was dispatched from, or any worktree of it",
        },
        branch: { type: String, description: "Branch the thread works on (required)" },
        state: { type: String, description: `One of ${CLOSING.join(", ")} (required)` },
        pr: { type: String, description: "Pull request URL" },
        note: { type: String, description: "Why, when the state is blocked or abandoned" },
        dataDir,
      },
    },
    async (argv) => {
      const state = z.enum(CLOSING).safeParse(argv.flags.state);
      if (argv.flags.branch == null || argv.flags.branch === "" || !state.success) {
        process.stderr.write(`--branch and --state (${CLOSING.join(", ")}) are required\n`);
        argv.showHelp();
        process.exit(2);
      }
      try {
        const row = await appendOutcome(
          {
            repo: await primaryRoot(argv.flags.repo),
            branch: argv.flags.branch,
            state: state.data,
            pr: argv.flags.pr,
            note: argv.flags.note,
          },
          resolveDataDir(argv.flags.dataDir),
        );
        process.stdout.write(`${JSON.stringify(row)}\n`);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    },
  );

  const status = command(
    {
      name: "status",
      help: { description: "Print the projects and the open threads, optionally filtered by tag." },
      flags: {
        tag: { type: [String], description: "Only threads carrying this key=value; repeatable" },
        json: { type: Boolean, description: "Print the status as JSON" },
        dataDir,
      },
    },
    async (argv) => {
      let tags: Record<string, string>;
      try {
        tags = parseTags(argv.flags.tag);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(2);
      }
      const dir = resolveDataDir(argv.flags.dataDir);
      const [projects, rows, live] = await Promise.all([
        readProjects(dir),
        readLedger(dir),
        liveAgents(),
      ]);
      const built = buildStatus(projects, rows, tags, live);
      process.stdout.write(
        argv.flags.json ? `${JSON.stringify(built)}\n` : formatStatus(built, new Date()),
      );
    },
  );

  await cli(
    {
      name: "ledger",
      help: { description: "Read and extend the dispatch ledger." },
      commands: [outcome, status],
    },
    (argv) => {
      argv.showHelp();
      process.exit(2);
    },
  );
}
