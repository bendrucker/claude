import { homedir } from "node:os";
import { join } from "node:path";

// The voice baseline is local-only and never committed. It lives outside the
// repository at the plugin data dir so it can later grow to include private
// writing. Resolve CLAUDE_PLUGIN_DATA if set, else the conventional default.
export function resolveDataDir(override?: string): string {
  if (override) return override;
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
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
