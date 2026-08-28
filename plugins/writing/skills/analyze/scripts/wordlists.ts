import { readdirSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export interface WordlistEntry {
  phrase: string;
  source: string;
}

const FileError = z.looseObject({ code: z.string().optional().catch(undefined) });

export async function loadWordlists(dir: string): Promise<WordlistEntry[]> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
  } catch (err) {
    if (FileError.safeParse(err).data?.code === "ENOENT") return [];
    throw err;
  }
  const entries: WordlistEntry[] = [];
  for (const file of files.toSorted()) {
    const text = await Bun.file(path.join(dir, file)).text();
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (line.length === 0) continue;
      const phrase = line.replace(/\s+[\d.]+$/, "");
      entries.push({ phrase, source: file });
    }
  }
  return entries;
}
