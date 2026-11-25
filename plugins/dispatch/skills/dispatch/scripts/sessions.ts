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
  id: string;
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
        order: z.number().int().optional(),
      }),
    )
    .default([]),
});

export function defaultSessionsFile(): string {
  return join(homedir(), ".config", "rex", "sessions.toml");
}

export interface Descriptions {
  descriptions: Map<string, string>;
  orders: Map<string, number>;
  warning?: string;
}

export function parseDescriptions(text: string): Descriptions {
  try {
    const parsed = SessionsFileSchema.parse(parseToml(text));
    const descriptions = new Map<string, string>();
    const orders = new Map<string, number>();
    for (const entry of parsed.session) {
      if (entry.description != null) descriptions.set(entry.name, entry.description);
      if (entry.order != null) orders.set(entry.name, entry.order);
    }
    return { descriptions, orders };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      descriptions: new Map(),
      orders: new Map(),
      warning: `ignoring malformed sessions file: ${reason}`,
    };
  }
}

export async function loadDescriptions(file: string): Promise<Descriptions> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return { descriptions: new Map(), orders: new Map() };
  return parseDescriptions(await handle.text());
}

/** Sessions with an `order` first, ascending, then the rest in Rex's order. */
export function sortSessions(
  sessions: readonly LiveSession[],
  orders: ReadonlyMap<string, number>,
): LiveSession[] {
  const rank = (s: LiveSession) => orders.get(s.label) ?? Number.MAX_SAFE_INTEGER;
  return sessions.toSorted((a, b) => rank(a) - rank(b));
}

export async function applyOrder(
  run: RexRunner,
  server: string | undefined,
  sorted: readonly LiveSession[],
  orders: ReadonlyMap<string, number>,
): Promise<void> {
  const ordered = sorted.filter((s) => orders.has(s.label));
  for (const [index, session] of ordered.entries()) {
    const argv = ["session", "move", session.id, "--index", String(index + 1)];
    // oxlint-disable-next-line no-await-in-loop -- each index assumes the earlier moves finished.
    const result = await run(["rex", ...(server == null ? [] : ["-S", server]), ...argv]);
    if (result.code !== 0)
      throw new Error(`rex session move ${session.label} failed: ${result.stderr.trim()}`);
  }
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
        id: session.session_id,
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

const BlockSessionSchema = z.object({ session_id: z.string().min(1) });

// Rex no longer sets REX_SESSION in new terminals. A closed pane's block is
// gone, and REX_SESSION is then the only record of its session. A block ID
// works as `-s`, which keeps an inherited REX_BLOCK from scoping the lookup.
export async function currentSession(
  env: Readonly<Record<string, string | undefined>>,
  run: RexRunner,
): Promise<string | undefined> {
  const fallback = env.REX_SESSION === "" ? undefined : env.REX_SESSION;
  const block = env.REX_BLOCK ?? "";
  if (block === "") return fallback;
  try {
    const inspected = await rexJson(
      run,
      undefined,
      ["block", "inspect", "-s", block, block, "--json"],
      BlockSessionSchema,
    );
    return inspected.session_id;
  } catch {
    return fallback;
  }
}

export function createSessionsCommand(run: RexRunner): Command {
  return new Command("sessions")
    .description("List live Rex sessions with their tabs, directories, and descriptions.")
    .option("--host <label>", "list this saved host's sessions instead (`rex hosts list`)")
    .option("--data-dir <dir>", "dispatch ledger directory; defaults to the plugin data dir")
    .option("--sessions-file <file>", "descriptions file", defaultSessionsFile())
    .option("--apply-order", "move sessions with an `order` to the top of Rex's session list")
    .action(async (options) => {
      let live: LiveSession[];
      try {
        live = await listLiveSessions(run, options.host);
      } catch (error) {
        if (error instanceof HostUnreachableError) {
          process.stderr.write(`host \`${error.message}\` is unreachable\n`);
        } else {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        }
        process.exit(1);
      }
      const { descriptions, orders, warning } = await loadDescriptions(options.sessionsFile);
      if (warning != null) process.stderr.write(`warning: ${warning}\n`);
      const sessions = sortSessions(live, orders);
      if (options.applyOrder) await applyOrder(run, options.host, sessions, orders);
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
