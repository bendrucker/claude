import { cli, command } from "cleye";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { table } from "table";
import { type AnchorSide, type HunkNote, deriveAnchor } from "./note";

export type { AnchorSide, HunkNote, NoteSource } from "./note";

export interface LedgerRecord {
  noteId: string;
  filePath: string;
  anchor: { side: AnchorSide; line: number };
  body: string;
  resolved: boolean;
  action?: string;
  ref?: string;
  updatedAt: string;
}

export interface LedgerOptions {
  dir: string;
  repo: string;
  branch: string;
  now?: () => string;
}

export interface ReconcileResult {
  orphaned: LedgerRecord[];
}

export function defaultLedgerDir(): string {
  return join(homedir(), ".claude", "plugins", "data", "claude-review", "hunk-ledger");
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

interface LedgerFile {
  repo: string;
  branch: string;
  records: LedgerRecord[];
}

export class Ledger {
  private readonly dir: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly now: () => string;
  private readonly path: string;
  private records: Map<string, LedgerRecord>;

  constructor(opts: LedgerOptions) {
    this.dir = opts.dir;
    this.repo = opts.repo;
    this.branch = opts.branch;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.path = join(this.dir, `${sanitize(opts.repo)}__${sanitize(opts.branch)}.json`);
    this.records = this.load();
  }

  get filePath(): string {
    return this.path;
  }

  private load(): Map<string, LedgerRecord> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Map();
      }
      throw error;
    }
    const data = JSON.parse(raw) as LedgerFile;
    return new Map(data.records.map((record) => [record.noteId, record]));
  }

  private persist(): void {
    mkdirSync(this.dir, { recursive: true });
    const data: LedgerFile = {
      repo: this.repo,
      branch: this.branch,
      records: [...this.records.values()],
    };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, this.path);
  }

  upsert(note: HunkNote): LedgerRecord {
    const existing = this.records.get(note.noteId);
    const anchor = deriveAnchor(note);
    const record: LedgerRecord = {
      noteId: note.noteId,
      filePath: note.filePath,
      anchor: { side: anchor.side, line: anchor.line },
      body: note.body,
      resolved: existing?.resolved ?? false,
      updatedAt: this.now(),
    };
    if (existing?.action !== undefined) {
      record.action = existing.action;
    }
    if (existing?.ref !== undefined) {
      record.ref = existing.ref;
    }
    this.records.set(note.noteId, record);
    this.persist();
    return record;
  }

  markResolved(noteId: string, info?: { action?: string; ref?: string }): LedgerRecord {
    const record = this.records.get(noteId);
    if (!record) {
      throw new Error(`No ledger record for note ${noteId}`);
    }
    record.resolved = true;
    if (info?.action !== undefined) {
      record.action = info.action;
    }
    if (info?.ref !== undefined) {
      record.ref = info.ref;
    }
    record.updatedAt = this.now();
    this.persist();
    return record;
  }

  isResolved(noteId: string): boolean {
    return this.records.get(noteId)?.resolved ?? false;
  }

  get(noteId: string): LedgerRecord | undefined {
    return this.records.get(noteId);
  }

  all(): LedgerRecord[] {
    return [...this.records.values()];
  }

  open(): LedgerRecord[] {
    return this.all().filter((record) => !record.resolved);
  }

  resolved(): LedgerRecord[] {
    return this.all().filter((record) => record.resolved);
  }

  reconcile(currentNoteIds: string[]): ReconcileResult {
    const present = new Set(currentNoteIds);
    const orphaned = this.all().filter((record) => !present.has(record.noteId));
    return { orphaned };
  }
}

function git(args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args]);
  if (result.exitCode !== 0) return undefined;
  const out = result.stdout.toString().trim();
  return out === "" ? undefined : out;
}

function resolveLedger(flags: { repo?: string; branch?: string; dir?: string }): Ledger {
  const repo = flags.repo ?? git(["rev-parse", "--show-toplevel"]);
  const branch = flags.branch ?? git(["branch", "--show-current"]);
  const dir = flags.dir ?? defaultLedgerDir();
  if (!repo) {
    console.error("Could not determine repo; pass --repo");
    process.exit(1);
  }
  if (!branch) {
    console.error("Could not determine branch; pass --branch");
    process.exit(1);
  }
  return new Ledger({ dir, repo, branch });
}

function parseNotes(raw: string): HunkNote[] {
  const data = JSON.parse(raw) as { comments: HunkNote[] } | HunkNote[];
  return Array.isArray(data) ? data : data.comments;
}

function printRecords(records: LedgerRecord[], asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  if (records.length === 0) {
    console.error("No records");
    return;
  }
  const rows = [
    ["noteId", "file", "anchor", "status", "action", "ref"],
    ...records.map((r) => [
      r.noteId,
      r.filePath,
      `${r.anchor.side}:${r.anchor.line}`,
      r.resolved ? "resolved" : "open",
      r.action ?? "",
      r.ref ?? "",
    ]),
  ];
  console.log(table(rows));
}

const storageFlags = {
  repo: { type: String, description: "Repo identifier (default: git toplevel)" },
  branch: { type: String, description: "Branch name (default: current branch)" },
  dir: { type: String, description: "Ledger storage dir (default: plugin data dir)" },
} as const;

const resolveCmd = command(
  {
    name: "resolve",
    parameters: ["<noteId>"],
    flags: {
      ...storageFlags,
      action: { type: String, description: "Action taken (e.g. applied)" },
      ref: { type: String, description: "Reference (e.g. commit sha)" },
    },
  },
  (parsed) => {
    const ledger = resolveLedger(parsed.flags);
    const record = ledger.markResolved(parsed._.noteId, {
      action: parsed.flags.action,
      ref: parsed.flags.ref,
    });
    console.error(`Resolved ${record.noteId}`);
  },
);

const upsertCmd = command(
  {
    name: "upsert",
    flags: { ...storageFlags },
  },
  async (parsed) => {
    const ledger = resolveLedger(parsed.flags);
    const notes = parseNotes(await Bun.stdin.text());
    for (const note of notes) {
      ledger.upsert(note);
    }
    console.error(`Upserted ${notes.length} note(s)`);
  },
);

const listCmd = command(
  {
    name: "list",
    flags: {
      ...storageFlags,
      open: { type: Boolean, description: "Only open records", default: false },
      resolved: { type: Boolean, description: "Only resolved records", default: false },
      json: { type: Boolean, description: "Emit JSON", default: false },
    },
  },
  (parsed) => {
    const ledger = resolveLedger(parsed.flags);
    let records = ledger.all();
    if (parsed.flags.open) records = records.filter((r) => !r.resolved);
    if (parsed.flags.resolved) records = records.filter((r) => r.resolved);
    printRecords(records, parsed.flags.json);
  },
);

const reconcileCmd = command(
  {
    name: "reconcile",
    flags: { ...storageFlags },
  },
  async (parsed) => {
    const ledger = resolveLedger(parsed.flags);
    const raw = (await Bun.stdin.text()).trim();
    let noteIds: string[];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      noteIds = parseNotes(raw).map((n) => n.noteId);
    } else {
      noteIds = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }
    const { orphaned } = ledger.reconcile(noteIds);
    console.log(JSON.stringify(orphaned, null, 2));
  },
);

if (import.meta.main) {
  cli({
    name: "ledger",
    commands: [resolveCmd, upsertCmd, listCmd, reconcileCmd],
  });
}
