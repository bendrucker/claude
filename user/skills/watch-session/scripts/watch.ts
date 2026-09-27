#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { cli, command } from "cleye";
import { z } from "zod";
import { decodeJson } from "../../../../packages/decode/index";
import { type Blocked, render, splitLines, type Turn, TurnTracker } from "./transcript";

const PANE_CHECK_MS = 10_000;

const Snapshot = z.object({
  result: z.object({
    snapshot: z.object({
      agents: z.array(
        z.object({
          pane_id: z.string(),
          agent_session: z.object({ value: z.string() }).nullish(),
        }),
      ),
    }),
  }),
});

const State = z.object({ offset: z.number() });

interface Target {
  session: string;
  path: string;
}

/** Returns the pane's current Claude session UUID, or undefined when the pane or its agent is gone. */
async function paneSession(pane: string): Promise<string | undefined> {
  const text = await $`herdr api snapshot`.text();
  const agents = decodeJson(Snapshot, text, "herdr api snapshot").result.snapshot.agents;
  return agents.find((a) => a.pane_id === pane)?.agent_session?.value;
}

async function transcriptPath(session: string): Promise<string> {
  const root = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  for await (const path of new Bun.Glob(`*/${session}.jsonl`).scan({ cwd: root, absolute: true })) {
    return path;
  }
  throw new Error(`no transcript for session ${session} under ${root}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function resolve(target: string): Promise<Target & { pane?: string }> {
  if (UUID.test(target)) return { session: target, path: await transcriptPath(target) };
  const session = await paneSession(target);
  if (session === undefined) throw new Error(`herdr pane ${target} has no Claude session`);
  return { session, path: await transcriptPath(session), pane: target };
}

function statePath(dir: string, session: string): string {
  return join(dir, `${session}.json`);
}

async function readState(
  dir: string | undefined,
  session: string,
): Promise<z.output<typeof State> | undefined> {
  if (dir === undefined) return undefined;
  const path = statePath(dir, session);
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  return decodeJson(State, await file.text(), path);
}

function emit(event: object): void {
  console.log(JSON.stringify(event));
}

interface Batch {
  event: "batch";
  turns: number;
  from: number;
  to: number;
  prompts: string[];
  tools: Record<string, number>;
  skills: string[];
  errors: number;
}

function addToBatch(batch: Batch | undefined, turn: Turn): Batch {
  const next = batch ?? {
    event: "batch",
    turns: 0,
    from: turn.from,
    to: turn.to,
    prompts: [],
    tools: {},
    skills: [],
    errors: 0,
  };
  next.turns++;
  next.to = turn.to;
  if (turn.prompt !== "") next.prompts.push(turn.prompt);
  for (const [name, count] of Object.entries(turn.tools)) {
    next.tools[name] = (next.tools[name] ?? 0) + count;
  }
  next.skills.push(...turn.skills.filter((s) => !next.skills.includes(s)));
  next.errors += turn.errors;
  return next;
}

interface WatchOptions {
  target: string;
  stateDir?: string;
  fromStart: boolean;
  every: number;
  poll: number;
}

function startOffset(
  saved: z.output<typeof State> | undefined,
  target: Target,
  fromStart: boolean,
): number {
  if (saved) return saved.offset;
  return fromStart ? 0 : Bun.file(target.path).size;
}

class Watcher {
  private tracker = new TurnTracker();
  private batch: Batch | undefined;
  private lastPaneCheck = Date.now();
  private lastFlush = Date.now();

  constructor(
    private readonly options: WatchOptions,
    private target: Target,
    private readonly pane: string | undefined,
    private offset: number,
  ) {}

  /** Runs one poll. Returns false once the watched pane no longer hosts a Claude session. */
  async tick(): Promise<boolean> {
    await this.read();
    this.flush(false);
    return this.checkPane();
  }

  private async read(): Promise<void> {
    const size = Bun.file(this.target.path).size;
    if (size <= this.offset) return;
    const bytes = new Uint8Array(
      await Bun.file(this.target.path).slice(this.offset, size).arrayBuffer(),
    );
    const { lines, consumed } = splitLines(bytes, this.offset);
    this.offset += consumed;
    for (const event of lines.flatMap((line) => this.tracker.feed(line))) this.dispatch(event);
    await this.persist();
  }

  private dispatch(event: Turn | Blocked): void {
    if (this.options.every === 0) emit(event);
    else if (event.event === "turn") this.batch = addToBatch(this.batch, event);
  }

  private flush(force: boolean): void {
    if (!this.batch) return;
    if (!force && Date.now() - this.lastFlush < this.options.every * 1000) return;
    emit(this.batch);
    this.batch = undefined;
    this.lastFlush = Date.now();
  }

  private async checkPane(): Promise<boolean> {
    if (this.pane === undefined || Date.now() - this.lastPaneCheck < PANE_CHECK_MS) return true;
    this.lastPaneCheck = Date.now();
    const current = await paneSession(this.pane);
    if (current === undefined) {
      this.flush(true);
      emit({ event: "ended", reason: "pane has no Claude session" });
      return false;
    }
    if (current === this.target.session) return true;
    // A /clear or /resume in the watched pane starts a new transcript, so follow it from its first line.
    this.target = { session: current, path: await transcriptPath(current) };
    this.offset = 0;
    this.tracker = new TurnTracker();
    await this.persist();
    emit({ event: "session", ...this.target });
    return true;
  }

  async persist(): Promise<void> {
    if (this.options.stateDir === undefined) return;
    await mkdir(this.options.stateDir, { recursive: true });
    await Bun.write(
      statePath(this.options.stateDir, this.target.session),
      JSON.stringify({ offset: this.offset }),
    );
  }
}

async function watch(options: WatchOptions): Promise<void> {
  const { pane, ...target } = await resolve(options.target);
  const offset = startOffset(
    await readState(options.stateDir, target.session),
    target,
    options.fromStart,
  );
  const watcher = new Watcher(options, target, pane, offset);
  await watcher.persist();
  emit({ event: "watching", ...target, offset, pane });

  // Monitor needs one long-lived process that sleeps internally, not a shell loop.
  // oxlint-disable-next-line no-await-in-loop -- each poll must finish before the next begins.
  while (await watcher.tick()) await Bun.sleep(options.poll);
}

async function show(target: string, from: number, to: number | undefined, truncate: number) {
  const { path } = await resolve(target);
  const file = Bun.file(path);
  const bytes = new Uint8Array(await file.slice(from, to ?? file.size).arrayBuffer());
  for (const line of render(splitLines(bytes, from).lines, truncate)) console.log(line);
}

const watchCmd = command(
  {
    name: "watch",
    parameters: ["<target>"],
    help: {
      description:
        "Tail a Claude session's transcript and print one JSON event per line: turn, blocked, batch, session, ended.",
    },
    flags: {
      stateDir: {
        type: String,
        description:
          "Directory holding <session>.json, which persists the read offset across restarts",
      },
      fromStart: {
        type: Boolean,
        description: "Read from the start of the transcript instead of its end",
      },
      every: {
        type: Number,
        default: 0,
        description:
          "Batch completed turns into one event per interval in seconds (0 emits per turn)",
      },
      poll: { type: Number, default: 1000, description: "Poll interval in milliseconds" },
    },
  },
  async (parsed) => {
    await watch({
      target: parsed._.target,
      ...parsed.flags,
      fromStart: parsed.flags.fromStart ?? false,
    });
  },
);

const showCmd = command(
  {
    name: "show",
    parameters: ["<target>", "<from>", "[to]"],
    help: {
      description: "Print a byte range of a Claude session's transcript, one line per block.",
    },
    flags: {
      truncate: { type: Number, default: 500, description: "Maximum characters per line" },
    },
  },
  async (parsed) => {
    const to = parsed._.to === undefined ? undefined : Number(parsed._.to);
    await show(parsed._.target, Number(parsed._.from), to, parsed.flags.truncate);
  },
);

if (import.meta.main) {
  await cli({ name: "watch-session", commands: [watchCmd, showCmd] }, (parsed) => {
    parsed.showHelp();
  });
}
