import type { EngineInterface, On } from "claude-code";
import type { ModEventsInput, ModEventsRecord } from "../types";

const MOD = "mod-events";
const CHUNK_BYTES = 64 * 1024;

interface Chunk {
  path: string;
  text: string;
  version: number;
  isWriting: boolean;
}

interface Log {
  root: string | undefined;
  instance: number | undefined;
  resource: Record<string, string> | undefined;
  chunks: Map<string, { chunk: Chunk; n: number }>;
}

export type Surface = "local" | "mosh" | "ssh";

interface Process {
  pid: number;
  ppid: number;
  name: string;
}

function parsePs(stdout: string): Map<number, Process> {
  const table = new Map<number, Process>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;
    const [, pid, ppid, command] = match;
    const name = command?.split("/").at(-1) ?? "";
    table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), name });
  }
  return table;
}

function reachOf(table: Map<number, Process>, pid: number): Surface {
  for (let p = table.get(pid); p !== undefined && p.pid > 1; p = table.get(p.ppid)) {
    if (p.name === "mosh-server") return "mosh";
    if (p.name === "sshd" || p.name.startsWith("sshd-")) return "ssh";
  }
  return "local";
}

function summarize(clients: Surface[], isSsh: boolean): Surface {
  if (clients.includes("mosh")) return "mosh";
  if (isSsh || clients.includes("ssh")) return "ssh";
  return "local";
}

/**
 * Classifies each attached herdr client by its ancestry. The server is the
 * `herdr` process whose parent is launchd, and every other one is a client.
 */
export function surfaceOf(
  ps: string | undefined,
  sshConnection: string | undefined,
): { surface: Surface; clients: Surface[] } {
  const clients: Surface[] = [];
  if (ps !== undefined) {
    const table = parsePs(ps);
    for (const p of table.values()) {
      if (p.name === "herdr" && p.ppid > 1) clients.push(reachOf(table, p.pid));
    }
  }
  // Panes inherit the herdr server's env, so `SSH_CONNECTION` speaks for the session only without clients.
  const isSsh = clients.length === 0 && sshConnection !== undefined && sshConnection !== "";
  return { surface: summarize(clients, isSsh), clients: clients.toSorted() };
}

async function flush($: EngineInterface, chunk: Chunk): Promise<void> {
  if (chunk.isWriting) return;
  chunk.isWriting = true;
  try {
    let written: number;
    do {
      written = chunk.version;
      // oxlint-disable-next-line no-await-in-loop -- each rewrite must land before the next, or an older text could win.
      await $.fs.write(chunk.path, chunk.text);
    } while (written !== chunk.version);
  } finally {
    chunk.isWriting = false;
  }
}

async function rootOf($: EngineInterface, log: Log): Promise<string | undefined> {
  if (log.root !== undefined) return log.root;
  const [config, home] = await Promise.all([$.env.get("CLAUDE_CONFIG_DIR"), $.env.get("HOME")]);
  if (config !== undefined && config !== "") log.root = `${config}/mod-events`;
  else if (home !== undefined) log.root = `${home}/.claude/mod-events`;
  return log.root;
}

const fileSafe = (name: string) => name.replaceAll(/[^\w.-]/g, "_");

async function resourceOf($: EngineInterface, log: Log): Promise<Record<string, string>> {
  log.resource ??= {
    "service.name": "claude-code",
    "service.version": (await $.session.version()).version,
  };
  return log.resource;
}

function toRecord(
  input: ModEventsInput,
  ts: number,
  session: string,
  resource: Record<string, string>,
): ModEventsRecord {
  const isOk = input.ok ?? true;
  return {
    timestamp: new Date(ts).toISOString(),
    severity_text: isOk ? "INFO" : "WARN",
    severity_number: isOk ? 9 : 13,
    event_name: `${input.mod}.${input.event}`,
    attributes: {
      ...input.detail,
      ...(input.ms !== undefined && { duration_ms: input.ms }),
      "session.id": session,
    },
    resource,
    scope: { name: input.mod },
  };
}

async function record($: EngineInterface, log: Log, input: ModEventsInput): Promise<void> {
  const [root, ts, session, resource] = await Promise.all([
    rootOf($, log),
    $.clock.now(),
    $.session.id(),
    resourceOf($, log),
  ]);
  if (root === undefined) return;
  log.instance ??= ts;
  const line = toRecord(input, ts, session, resource);
  const text = `${JSON.stringify(line)}\n`;
  const key = `${session}/${fileSafe(input.mod)}`;
  let slot = log.chunks.get(key);
  if (
    slot === undefined ||
    (slot.chunk.text !== "" && slot.chunk.text.length + text.length > CHUNK_BYTES)
  ) {
    const n = slot === undefined ? 0 : slot.n + 1;
    slot = {
      n,
      chunk: {
        path: `${root}/${key}.${log.instance}.${n}.jsonl`,
        text: "",
        version: 0,
        isWriting: false,
      },
    };
    log.chunks.set(key, slot);
  }
  slot.chunk.text += text;
  slot.chunk.version += 1;
  await flush($, slot.chunk);
}

async function emit($: EngineInterface, log: Log, input: ModEventsInput): Promise<void> {
  try {
    await record($, log, input);
  } catch (error) {
    $.ui.log(`mod-events: ${input.mod} ${input.event} not recorded: ${String(error)}`, {
      to: "debug",
    });
  }
}

async function readSurface($: EngineInterface): Promise<ReturnType<typeof surfaceOf>> {
  const [ssh, ps] = await Promise.all([
    $.env.get("SSH_CONNECTION"),
    $.process
      .run(["ps", "-axo", "pid=,ppid=,comm="], { timeoutMs: 5000 })
      .then((r) => (r.exitCode === 0 ? r.stdout : undefined))
      .catch(() => undefined),
  ]);
  return surfaceOf(ps, ssh);
}

/**
 * Seats `$.modEvents` for every mod that depends on this plugin and writes
 * what they emit as OTel log records to
 * `<config>/mod-events/<session>/<mod>.<instance>.<n>.jsonl`. A chunk is
 * rewritten whole on each event, since `$.fs` has no append, so chunks roll at
 * 64 KB and a reload starts a new instance. Each rewrite only appends, and a
 * rolled chunk is never written again, so a tailer's offset stays valid.
 */
export function register(on: On): void {
  const log: Log = { root: undefined, instance: undefined, resource: undefined, chunks: new Map() };

  on("engine.create", async ($, e, next) => {
    const built = await next(e);
    return { ...built, modEvents: { emit: () => Promise.resolve() } };
  });

  on("modEvents.emit", async ($, e, next) => {
    await emit($, log, e);
    return next(e);
  }).catch(($, e, next) => (next.called ? next(e) : { value: undefined }));

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    const { surface, clients } = await readSurface($);
    log.resource = { ...(await resourceOf($, log)), "claude_code.surface": surface };
    await emit($, log, {
      mod: MOD,
      event: "session.start",
      detail: { clients, surfaceKind: e.surface, isInteractive: e.isInteractive },
    });
    return started;
  });
}
