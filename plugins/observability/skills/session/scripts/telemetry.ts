import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database, ScannedFile } from "./db";
import { CatalogRow, diffCatalog } from "./file-catalog";

interface Entry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface DebugEvent {
  line: number;
  ts: string;
  event: string;
  fields: Record<string, string>;
}

const STALL = /^(\S+) \[\w+\] \[Stall\] (\w+)(.*)$/;
const IGNORED_RULE =
  /^(\S+) \[\w+\] Ignoring dangerous permission (.+) from (.+) \(bypasses classifier\)$/;

function parseFields(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const token of text.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return fields;
}

/**
 * The `[Stall]` timing lines and the allow rules auto mode dropped, out of one
 * `~/.claude/debug/<session>.txt`.
 */
export function parseDebugLog(text: string): DebugEvent[] {
  const events: DebugEvent[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const stall = STALL.exec(line);
    if (stall?.[1] !== undefined && stall[2] !== undefined) {
      events.push({
        line: index + 1,
        ts: stall[1],
        event: stall[2],
        fields: parseFields(stall[3] ?? ""),
      });
      continue;
    }
    const ignored = IGNORED_RULE.exec(line);
    if (ignored?.[1] !== undefined && ignored[2] !== undefined && ignored[3] !== undefined) {
      events.push({
        line: index + 1,
        ts: ignored[1],
        event: "dangerous_rule_ignored",
        fields: { rule: ignored[2], source: ignored[3] },
      });
    }
  }
  return events;
}

export interface Source {
  name: string;
  root: string;
  scan(entries: Entry[], root: string): ScannedFile[] | Promise<ScannedFile[]>;
  import(db: Database, file: ScannedFile): Promise<void>;
  remove(db: Database, path: string): Promise<void>;
}

function scanDebugLogs(entries: Entry[], root: string): ScannedFile[] {
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map((entry) => {
      const file = Bun.file(join(root, entry.name));
      return {
        path: join(root, entry.name),
        mtime: Math.trunc(file.lastModified),
        size: file.size,
      };
    });
}

// A session's records are one file each, so the directory is the unit of change. Its newest
// record and total bytes also catch a record rewritten after a partial read.
function scanRecordDirs(entries: Entry[], root: string): ScannedFile[] {
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(root, entry.name);
      let mtime = 0;
      let size = 0;
      for (const { name } of listRoot(path) ?? []) {
        if (!name.endsWith(".json")) continue;
        const file = Bun.file(join(path, name));
        mtime = Math.max(mtime, file.lastModified);
        size += file.size;
      }
      return { path, mtime: Math.trunc(mtime), size };
    })
    .filter((dir) => dir.size > 0);
}

const debugLogs = (root: string, host: string): Source => ({
  name: "debug",
  root,
  scan: scanDebugLogs,
  async import(db, file) {
    const events = parseDebugLog(await Bun.file(file.path).text());
    await db.run("DELETE FROM debug_events WHERE source_file = $path", { path: file.path });
    if (events.length === 0) return;
    await db.run(
      `INSERT INTO debug_events
       SELECT $host, $session, $path,
              (e->>'line')::BIGINT, TRY_CAST(e->>'ts' AS TIMESTAMP), e->>'event', e->'fields'
       FROM (SELECT unnest(from_json($events, '["JSON"]')) AS e)`,
      {
        host,
        session: basename(file.path, ".txt"),
        path: file.path,
        events: JSON.stringify(events),
      },
    );
  },
  async remove(db, path) {
    await db.run("DELETE FROM debug_events WHERE source_file = $path", { path });
  },
});

const callRecords = (root: string, host: string): Source => ({
  name: "calls",
  root,
  scan: scanRecordDirs,
  async import(db, file) {
    await db.run("DELETE FROM tool_verdicts WHERE source_dir = $path", { path: file.path });
    await db.run(
      `INSERT INTO tool_verdicts
       SELECT $host, session_id, tool_use_id, agent_id, tool, decision, rule, reason,
              make_timestamp_ms(started_at), check_ms, duration_ms, outcome, $path
       FROM read_json(
         $glob,
         columns = {
           session_id: 'VARCHAR', tool_use_id: 'VARCHAR', agent_id: 'VARCHAR',
           tool: 'VARCHAR', decision: 'VARCHAR', rule: 'VARCHAR', reason: 'VARCHAR',
           started_at: 'BIGINT', check_ms: 'BIGINT', duration_ms: 'BIGINT', outcome: 'VARCHAR'
         },
         format = 'newline_delimited',
         ignore_errors = true
       )
       WHERE tool_use_id IS NOT NULL`,
      { host, path: file.path, glob: join(file.path, "*.json") },
    );
  },
  async remove(db, path) {
    await db.run("DELETE FROM tool_verdicts WHERE source_dir = $path", { path });
  },
});

async function reimport(db: Database, source: Source, file: ScannedFile): Promise<void> {
  await db.run("BEGIN");
  await source.import(db, file);
  await db.run("DELETE FROM telemetry_files WHERE source = $source AND path = $path", {
    source: source.name,
    path: file.path,
  });
  await db.run("INSERT INTO telemetry_files VALUES ($source, $path, $mtime, $size)", {
    source: source.name,
    path: file.path,
    mtime: String(file.mtime),
    size: String(file.size),
  });
  await db.run("COMMIT");
}

async function reap(db: Database, source: Source, path: string): Promise<void> {
  await db.run("BEGIN");
  await source.remove(db, path);
  await db.run("DELETE FROM telemetry_files WHERE source = $source AND path = $path", {
    source: source.name,
    path,
  });
  await db.run("COMMIT");
}

// Like a host root, a missing directory is skipped rather than read as every file deleted.
function listRoot(root: string): Entry[] | undefined {
  try {
    return readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function stillScans(source: Source, path: string): Promise<boolean> {
  const scanned = await source.scan(listRoot(source.root) ?? [], source.root);
  return scanned.some((file) => file.path === path);
}

export async function syncSource(db: Database, source: Source): Promise<number> {
  const entries = listRoot(source.root);
  if (entries === undefined) return 0;
  const scanned = await source.scan(entries, source.root);
  const indexed = await db.query(
    "SELECT path, mtime, size FROM telemetry_files WHERE source = $source",
    CatalogRow,
    { source: source.name },
  );
  const { changed, removed } = diffCatalog(scanned, indexed);

  for (const file of changed) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh, and each file commits as its own transaction.
      await reimport(db, source, file);
    } catch (error) {
      // oxlint-disable-next-line no-await-in-loop -- the rollback must land before the next file's BEGIN.
      await db.run("ROLLBACK");
      // A file deleted since the scan is reaped on the next pass.
      // oxlint-disable-next-line no-await-in-loop -- a rare path, rescanned only on failure.
      if (await stillScans(source, file.path)) throw error;
    }
  }
  for (const file of removed) {
    // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh, and each file commits as its own transaction.
    await reap(db, source, file.path);
  }
  return changed.length + removed.length;
}

/**
 * Indexes this machine's debug logs and classifier-telemetry records, which live beside
 * its projects directory. Returns how many files or record directories changed.
 */
export async function ensureTelemetry(
  db: Database,
  projectsDir: string,
  host: string,
): Promise<number> {
  const configDir = dirname(projectsDir);
  let changed = 0;
  for (const source of [
    debugLogs(join(configDir, "debug"), host),
    callRecords(join(configDir, "classifier-telemetry"), host),
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one DuckDB connection serves the refresh.
    changed += await syncSource(db, source);
  }
  return changed;
}
