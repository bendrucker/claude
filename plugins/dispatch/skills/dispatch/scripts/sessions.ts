import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import { parse as parseToml } from "smol-toml";
import { table } from "table";
import { z } from "zod";
import { isClosedRow, type LedgerRow, readLedger, resolveDataDir } from "./ledger";

const RECENT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export type RexRunner = (argv: readonly string[]) => Promise<Result>;

export interface LiveSession {
  label: string;
  tabs: string[];
  cwds: string[];
}

const SessionsFileSchema = z.object({
  session: z
    .array(
      z.object({
        name: z.string(),
        path: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .default([]),
});

export function defaultSessionsFile(): string {
  return join(homedir(), ".config", "rex", "sessions.toml");
}

export interface Descriptions {
  descriptions: Map<string, string>;
  warning?: string;
}

export function parseDescriptions(text: string): Descriptions {
  try {
    const parsed = SessionsFileSchema.parse(parseToml(text));
    const descriptions = new Map<string, string>();
    for (const entry of parsed.session) {
      if (entry.description != null) descriptions.set(entry.name, entry.description);
    }
    return { descriptions };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { descriptions: new Map(), warning: `ignoring malformed sessions file: ${reason}` };
  }
}

export async function loadDescriptions(file: string): Promise<Descriptions> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return { descriptions: new Map() };
  return parseDescriptions(await handle.text());
}

export function recentAreas(
  rows: readonly LedgerRow[],
  live: ReadonlySet<string>,
  now: Date,
): string[] {
  const cutoff = now.getTime() - RECENT_DAYS * DAY_MS;
  const areas = new Set<string>();
  for (const row of rows) {
    if (isClosedRow(row) || row.rexSession == null) continue;
    const ts = Date.parse(row.ts);
    if (Number.isNaN(ts) || ts < cutoff) continue;
    if (!live.has(row.rexSession)) areas.add(row.rexSession);
  }
  return [...areas].toSorted();
}

const SessionListSchema = z.object({
  sessions: z.array(z.object({ session_id: z.string(), label: z.string() })),
});
const SessionViewSchema = z.object({
  windows: z.array(
    z.object({
      label: z.string().optional(),
      layers: z
        .array(z.object({ blocks: z.array(z.object({ block_id: z.string() })).default([]) }))
        .default([]),
    }),
  ),
});
const ProcessSchema = z.object({
  foreground: z.object({ cwd: z.string().optional() }).nullish(),
});
const PwdSchema = z.object({ pwd: z.string().optional() });

export class HostUnreachableError extends Error {
  override name = "HostUnreachableError";
}

async function rexJson<T>(
  run: RexRunner,
  server: string | undefined,
  args: string[],
  schema: z.ZodType<T>,
): Promise<T> {
  const result = await run(["rex", ...(server == null ? [] : ["-S", server]), ...args]);
  const reason = result.stderr.trim();
  if (result.code !== 0) throw new Error(reason === "" ? `rex ${args[0]} failed` : reason);
  return schema.parse(JSON.parse(result.stdout));
}

async function blockCwd(
  run: RexRunner,
  server: string | undefined,
  id: string,
): Promise<string | undefined> {
  try {
    const proc = await rexJson(run, server, ["block", "call", "-b", id, "process"], ProcessSchema);
    if (proc.foreground?.cwd != null) return proc.foreground.cwd;
    return (await rexJson(run, server, ["block", "call", "-b", id, "pwd"], PwdSchema)).pwd;
  } catch {
    // A block without a process has no directory to report.
    return undefined;
  }
}

export async function listLiveSessions(run: RexRunner, server?: string): Promise<LiveSession[]> {
  let list: z.infer<typeof SessionListSchema>;
  try {
    list = await rexJson(run, server, ["ls", "--json"], SessionListSchema);
  } catch (error) {
    if (server != null) throw new HostUnreachableError(server);
    throw error;
  }
  return Promise.all(
    list.sessions.map(async (session) => {
      const view = await rexJson(
        run,
        server,
        ["api", "call", "-s", session.session_id, "session.view"],
        SessionViewSchema,
      );
      const ids = view.windows.flatMap((w) =>
        w.layers.flatMap((l) => l.blocks.map((b) => b.block_id)),
      );
      const cwds = await Promise.all(ids.map((id) => blockCwd(run, server, id)));
      return {
        label: session.label,
        tabs: view.windows.flatMap((w) => w.label ?? []),
        cwds: [...new Set(cwds.flatMap((c) => c ?? []))],
      };
    }),
  );
}

export function renderSessions(
  sessions: readonly LiveSession[],
  descriptions: ReadonlyMap<string, string>,
  areas: readonly string[],
): string {
  const rows = [
    ["SESSION", "TABS", "CWDS", "DESCRIPTION"],
    ...sessions.map((s) => [
      s.label,
      s.tabs.join(", "),
      s.cwds.join("\n"),
      descriptions.get(s.label) ?? "",
    ]),
  ];
  const lines = [table(rows, { drawHorizontalLine: () => false }).trimEnd()];
  if (areas.length > 0) {
    lines.push("", `Recent areas (last ${RECENT_DAYS} days, no live session):`);
    for (const area of areas) {
      const description = descriptions.get(area);
      lines.push(description == null ? `  ${area}` : `  ${area}: ${description}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function resolveSessionLabel(run: RexRunner, session: string): Promise<string> {
  try {
    const list = await rexJson(run, undefined, ["ls", "--json"], SessionListSchema);
    const match = list.sessions.find((s) => s.session_id === session || s.label === session);
    return match?.label ?? session;
  } catch {
    return session;
  }
}

export function createSessionsCommand(run: RexRunner): Command {
  return new Command("sessions")
    .description("List live Rex sessions with their tabs, directories, and descriptions.")
    .option("--host <label>", "list this saved host's sessions instead (`rex hosts list`)")
    .option("--data-dir <dir>", "dispatch ledger directory; defaults to the plugin data dir")
    .option("--sessions-file <file>", "descriptions file", defaultSessionsFile())
    .action(async (options) => {
      let sessions: LiveSession[];
      try {
        sessions = await listLiveSessions(run, options.host);
      } catch (error) {
        if (error instanceof HostUnreachableError) {
          process.stderr.write(`host \`${error.message}\` is unreachable\n`);
        } else {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
        process.exit(1);
      }
      const { descriptions, warning } = await loadDescriptions(options.sessionsFile);
      if (warning != null) process.stderr.write(`warning: ${warning}\n`);
      const areas =
        options.host == null
          ? recentAreas(
              readLedger(resolveDataDir(options.dataDir)),
              new Set(sessions.map((s) => s.label)),
              new Date(),
            )
          : [];
      process.stdout.write(renderSessions(sessions, descriptions, areas));
    });
}
