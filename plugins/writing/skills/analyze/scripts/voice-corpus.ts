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
