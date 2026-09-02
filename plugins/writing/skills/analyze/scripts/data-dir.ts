import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// The voice baseline is local-only and never committed. It lives outside the
// repository at the plugin data dir so it can later grow to include private
// writing. Resolve CLAUDE_PLUGIN_DATA if set, else the conventional default.
export function resolveDataDir(override?: string): string {
  if (override != null && override !== "") return override;
  if (process.env.CLAUDE_PLUGIN_DATA != null && process.env.CLAUDE_PLUGIN_DATA !== "")
    return process.env.CLAUDE_PLUGIN_DATA;
  return join(homedir(), ".claude", "plugins", "data", "writing-bendrucker");
}

export function voiceBaselineDir(dataDir: string): string {
  return join(dataDir, "voice-baseline");
}

// The seed corpus shipped with the data dir: one normalized text file with
// per-document delimiter lines. ingest-voice.ts appends new sources here.
export function corpusPath(dataDir: string): string {
  return join(voiceBaselineDir(dataDir), "github-prs.txt");
}

export function profilePath(dataDir: string): string {
  return join(voiceBaselineDir(dataDir), "profile.json");
}

// The voice baseline grew past its seed file into one delimited corpus per
// register (sent mail, dictation, blog, and so on). Everything ending in .txt
// there is a register, so adding one needs no code change.
export async function registerPaths(dataDir: string): Promise<string[]> {
  const dir = voiceBaselineDir(dataDir);
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.endsWith(".txt"))
    .toSorted()
    .map((entry) => join(dir, entry));
}

// The contrast pole for similarity scoring: Claude-written prose in the same
// delimited format. Local-only for the same reason the voice baseline is.
export function contrastBaselineDir(dataDir: string): string {
  return join(dataDir, "contrast-baseline");
}

export function contrastCorpusPath(dataDir: string): string {
  return join(contrastBaselineDir(dataDir), "claude-deliverables.txt");
}

export function similarityProfilePath(dataDir: string): string {
  return join(voiceBaselineDir(dataDir), "similarity.json");
}
