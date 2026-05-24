import { readdirSync } from "node:fs";
import * as path from "node:path";

export interface WordlistEntry {
  phrase: string;
  source: string;
}

export async function loadWordlists(dir: string): Promise<WordlistEntry[]> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: WordlistEntry[] = [];
  for (const file of files.sort()) {
    const text = await Bun.file(path.join(dir, file)).text();
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (line.length === 0) continue;
      entries.push({ phrase: line, source: file });
    }
  }
  return entries;
}
