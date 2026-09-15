import { readdirSync } from "node:fs";
import { join } from "node:path";
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
  } catch (error) {
    if (FileError.safeParse(error).data?.code === "ENOENT") return [];
    throw error;
  }
  const perFile = await Promise.all(
    files.toSorted().map(async (file) => {
      const text = await Bun.file(join(dir, file)).text();
      const entries: WordlistEntry[] = [];
      for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/#.*$/, "").trim();
        if (line.length === 0) continue;
        const phrase = line.replace(/\s+[\d.]+$/, "");
        entries.push({ phrase, source: file });
      }
      return entries;
    }),
  );
  return perFile.flat();
}
