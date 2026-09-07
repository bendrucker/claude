import { isProseFile } from "../../../detection/paths";

export interface VoiceDocument {
  source: string;
  meta: string;
  body: string;
}

// A delimiter line marks the start of a document. The captured group is the
// source pointer (a URL for GitHub PRs); the trailing parenthetical is metadata
// (date and diff size) kept for provenance but not counted as prose.
const DELIMITER = /^=====\s+(\S+)\s+\(([^)]*)\)\s+=====$/;

export function parseCorpus(text: string): VoiceDocument[] {
  const docs: VoiceDocument[] = [];
  let current: VoiceDocument | null = null;
  const lines: string[] = [];

  const flush = (): void => {
    if (!current) return;
    docs.push({ ...current, body: lines.join("\n").trim() });
    lines.length = 0;
  };

  for (const line of text.split("\n")) {
    const match = DELIMITER.exec(line);
    if (match) {
      flush();
      current = { source: match[1] ?? "", meta: match[2] ?? "", body: "" };
      continue;
    }
    if (current) lines.push(line);
  }
  flush();
  return docs;
}

// The genre of a document, read off its source pointer: the file the prose was
// written to, or a session id when the miner found it on a command line instead
// (`gh pr create --body`, `git commit -m`), which makes it a message.
export type DocumentKind = "message" | "plan" | "memory" | "scratch" | "docs" | "other";

export const DOCUMENT_KINDS: readonly DocumentKind[] = [
  "message",
  "plan",
  "memory",
  "scratch",
  "docs",
  "other",
];

// Sources carry an occurrence index so a file written repeatedly stays distinct.
const OCCURRENCE_SUFFIX = /#\d+$/;
// Tool inputs record scratch paths both absolutely and relative to a repo root.
const SCRATCH_DIR = /(?:^|\/)tmp\//;

export function documentKind(source: string): DocumentKind {
  const path = source.replace(OCCURRENCE_SUFFIX, "");
  if (!path.includes("/")) return "message";
  if (path.includes("/.claude/plans/")) return "plan";
  if (path.includes("/memory/")) return "memory";
  if (SCRATCH_DIR.test(path)) return "scratch";
  if (isProseFile(path)) return "docs";
  return "other";
}

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

export function groupByKind(docs: VoiceDocument[]): Map<DocumentKind, VoiceDocument[]> {
  return Map.groupBy(docs, (doc) => documentKind(doc.source));
}

// Alternate rather than cut, so both halves draw on the same sessions and dates.
export function splitHalves<T>(items: T[]): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  for (const [index, item] of items.entries()) {
    (index % 2 === 0 ? left : right).push(item);
  }
  return [left, right];
}

export function formatDocument(doc: VoiceDocument): string {
  return `===== ${doc.source} (${doc.meta}) =====\n${doc.body.trim()}\n`;
}

// Serialize a set of documents back to the on-disk corpus format. Documents are
// separated by a blank line so the file stays human-readable.
export function serializeCorpus(docs: VoiceDocument[]): string {
  return `${docs.map(formatDocument).join("\n\n")}\n`;
}

// Merge new documents into an existing corpus, de-duplicating by source pointer
// so re-ingesting the same range is idempotent. Existing entries win.
export function mergeDocuments(
  existing: VoiceDocument[],
  incoming: VoiceDocument[],
): VoiceDocument[] {
  const bySource = new Map<string, VoiceDocument>();
  for (const doc of existing) bySource.set(doc.source, doc);
  for (const doc of incoming) {
    if (!bySource.has(doc.source)) bySource.set(doc.source, doc);
  }
  return [...bySource.values()];
}
