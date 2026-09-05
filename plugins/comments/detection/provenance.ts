import { $ } from "bun";
import { z } from "zod";
import type { Comment } from "./types";

/** Git records committers, so this is evidence about authorship rather than proof of it: agent-written code is routinely committed under a human name. */
export const ProvenanceSchema = z.object({
  /** Some line of the comment is not yet committed. */
  uncommitted: z.boolean(),
  authors: z.array(z.string()),
  /** Date (YYYY-MM-DD) of the newest of those commits. */
  latest: z.string().nullable(),
  /** Agent-authorship evidence on those commits, quoted from the commit itself. */
  signals: z.array(z.string()),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

export interface BlamedLine {
  sha: string;
  author: string;
  mail: string;
  /** Author time, seconds since the epoch. */
  time: number;
}

const UNCOMMITTED_SHA = "0".repeat(40);

/** `<sha> <source line> <final line> [<group size>]`, the record opener in porcelain output. */
const HEADER = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/;

/** Parse `git blame --line-porcelain` output into a map from final line number to its blame. */
export function parseLinePorcelain(text: string): Map<number, BlamedLine> {
  const lines = new Map<number, BlamedLine>();
  let current: BlamedLine | null = null;
  for (const raw of text.split("\n")) {
    const header = HEADER.exec(raw);
    if (header) {
      current = { sha: header[1] ?? "", author: "", mail: "", time: 0 };
      lines.set(Number(header[2]), current);
      continue;
    }
    if (current == null) continue;
    if (raw.startsWith("\t")) {
      current = null;
      continue;
    }
    const space = raw.indexOf(" ");
    const key = space === -1 ? raw : raw.slice(0, space);
    const value = space === -1 ? "" : raw.slice(space + 1);
    if (key === "author") current.author = value;
    else if (key === "author-mail") current.mail = value.replace(/^<|>$/g, "");
    else if (key === "author-time") current.time = Number(value);
  }
  return lines;
}

/** Names an agent or bot in an author field or trailer value. */
const AGENT_NAME = /claude|anthropic|copilot|codex|cursor|devin|aider|gemini|\[bot\]/i;

/** A trailer whose value names an agent. */
const AGENT_TRAILER = /^(co-authored-by|co-developed-by|generated-by|assisted-by|agent):\s*(.+)$/i;

/** A trailer that only an agent session writes. */
const SESSION_TRAILER = /^claude-session:/i;

/** The attribution footer Claude Code appends to a commit body. */
const GENERATED_FOOTER = /generated with .*claude code/i;

const SIGNAL_WIDTH = 120;

/** Agent-authorship evidence in one commit's message, each match quoted verbatim. */
export function commitSignals(message: string): string[] {
  const signals: string[] = [];
  for (const raw of message.split("\n")) {
    const line = raw.trim();
    const trailer = AGENT_TRAILER.exec(line);
    const agentTrailer = trailer != null && AGENT_NAME.test(trailer[2] ?? "");
    if (agentTrailer || SESSION_TRAILER.test(line) || GENERATED_FOOTER.test(line)) {
      signals.push(line.slice(0, SIGNAL_WIDTH));
    }
  }
  return signals;
}

export function authorSignal(line: BlamedLine): string | null {
  const identity = `${line.author} <${line.mail}>`;
  return AGENT_NAME.test(identity) ? `author: ${identity}` : null;
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** A line the blame map lacks (an untracked file, a failed blame) counts as uncommitted. */
export function provenanceOf(
  comment: Comment,
  blame: Map<number, BlamedLine>,
  signalsBySha: Map<string, string[]>,
): Provenance {
  const authors = new Set<string>();
  const signals = new Set<string>();
  let uncommitted = false;
  let latest = 0;
  for (let n = comment.startLine; n <= comment.endLine; n++) {
    const line = blame.get(n);
    if (line == null || line.sha === UNCOMMITTED_SHA) {
      uncommitted = true;
      continue;
    }
    if (line.author !== "") authors.add(line.author);
    latest = Math.max(latest, line.time);
    const author = authorSignal(line);
    if (author != null) signals.add(author);
    for (const signal of signalsBySha.get(line.sha) ?? []) signals.add(signal);
  }
  return {
    uncommitted,
    authors: [...authors],
    latest: latest === 0 ? null : isoDate(latest),
    signals: [...signals],
  };
}

/** Bounds concurrent git subprocesses, since files collect in parallel. */
function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const GIT_CONCURRENCY = 8;

/** Record separator between commits in the `git show` batch. */
const RS = "\x1e";
/** Field separator between a commit's sha and its message. */
const FS = "\x1f";

/** Blames files and resolves the agent signals of the commits they name, caching commit lookups across files so a run pays one `git show` per commit. */
export class ProvenanceIndex {
  private readonly signals = new Map<string, string[]>();
  private readonly limit = limiter(GIT_CONCURRENCY);

  async blame(path: string): Promise<Map<number, BlamedLine>> {
    const result = await this.limit(() =>
      $`git blame --line-porcelain -- ${path}`.quiet().nothrow(),
    );
    return result.exitCode === 0 ? parseLinePorcelain(result.text()) : new Map();
  }

  async signalsFor(shas: Iterable<string>): Promise<Map<string, string[]>> {
    const unresolved = [...new Set(shas)].filter(
      (sha) => sha !== UNCOMMITTED_SHA && !this.signals.has(sha),
    );
    if (unresolved.length > 0) {
      const format = `%H${FS}%B${RS}`;
      const result = await this.limit(() =>
        $`git show -s --format=${format} ${unresolved}`.quiet().nothrow(),
      );
      for (const sha of unresolved) this.signals.set(sha, []);
      if (result.exitCode === 0) {
        for (const record of result.text().split(RS)) {
          const cut = record.indexOf(FS);
          if (cut === -1) continue;
          this.signals.set(record.slice(0, cut).trim(), commitSignals(record.slice(cut + 1)));
        }
      }
    }
    return this.signals;
  }

  /** Provenance for each comment of one file, in the order given. */
  async forFile(path: string, comments: Comment[]): Promise<Provenance[]> {
    if (comments.length === 0) return [];
    const blame = await this.blame(path);
    const shas = new Set<string>();
    for (const comment of comments) {
      for (let n = comment.startLine; n <= comment.endLine; n++) {
        const line = blame.get(n);
        if (line != null) shas.add(line.sha);
      }
    }
    const signals = await this.signalsFor(shas);
    return comments.map((comment) => provenanceOf(comment, blame, signals));
  }
}
