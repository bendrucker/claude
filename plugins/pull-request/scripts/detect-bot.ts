#!/usr/bin/env bun

import { homedir } from "node:os";
import { join } from "node:path";

export interface Provider {
  name: string;
  configs: string[];
  cli: string;
}

export const PROVIDERS: Provider[] = [
  { name: "greptile", configs: [".greptile/config.json"], cli: "greptile" },
  { name: "coderabbit", configs: [".coderabbit.yaml", ".coderabbit.yml"], cli: "coderabbit" },
];

export interface Cooldown {
  provider: string;
  remote?: string;
  pausedUntil: string;
  reason: string;
}

export type Which = (cli: string) => string | null;
export type ReadCooldowns = () => Promise<Cooldown[]>;
export type ReadRemote = () => Promise<string | null>;

export const COOLDOWN_PATH = join(homedir(), ".cache", "claude", "bot-review.json");

export function parseCooldowns(text: string): Cooldown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: Cooldown[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { provider, pausedUntil, reason, remote } = entry as Record<string, unknown>;
    if (typeof provider !== "string") continue;
    if (typeof reason !== "string") continue;
    if (typeof pausedUntil !== "string" || Number.isNaN(Date.parse(pausedUntil))) continue;
    if (typeof remote === "string") records.push({ provider, pausedUntil, reason, remote });
    else if (remote === undefined || remote === null)
      records.push({ provider, pausedUntil, reason });
  }
  return records;
}

export const readCooldowns: ReadCooldowns = async () =>
  parseCooldowns(
    await Bun.file(COOLDOWN_PATH)
      .text()
      .catch(() => ""),
  );

export const readRemote: ReadRemote = async () => {
  const origin = await Bun.$`git remote get-url origin`.quiet().nothrow();
  return origin.exitCode === 0 ? origin.text().trim() : null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const ZONED = /(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i;

// `pausedUntil` holds a calendar date, so render it in whatever zone the writer implied:
// a leading ISO date already is one, an explicit zone reads as UTC, and Date.parse takes
// everything else as local. Formatting all three as UTC moves the date a day either way.
function resumeDate(pausedUntil: string): string {
  const iso = ISO_DATE.exec(pausedUntil);
  if (iso) return iso[0];
  const parsed = new Date(Date.parse(pausedUntil));
  if (ZONED.test(pausedUntil.trim())) return parsed.toISOString().slice(0, 10);
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${parsed.getFullYear()}-${month}-${day}`;
}

function pause(cooldowns: Cooldown[], provider: string, remote: string | null, now: Date) {
  const live = cooldowns.filter(
    (record) =>
      record.provider === provider &&
      Date.parse(record.pausedUntil) > now.getTime() &&
      (record.remote === undefined || record.remote === remote),
  );
  if (live.length === 0) return null;
  // Overlapping pauses are conjunctive: the provider is back only once the last one lifts.
  const latest = live.reduce((a, b) =>
    Date.parse(a.pausedUntil) >= Date.parse(b.pausedUntil) ? a : b,
  );
  return `paused until ${resumeDate(latest.pausedUntil)} (${latest.reason})`;
}

export interface DetectOptions {
  which?: Which;
  cooldowns?: ReadCooldowns;
  remote?: ReadRemote;
  now?: Date;
}

export async function detect(root: string, options: DetectOptions = {}): Promise<string> {
  const {
    which = Bun.which,
    cooldowns = readCooldowns,
    remote = readRemote,
    now = new Date(),
  } = options;
  const records = await cooldowns();
  const origin = records.length > 0 ? await remote() : null;
  const lines: string[] = [];
  for (const provider of PROVIDERS) {
    let config: string | null = null;
    for (const path of provider.configs) {
      if (await Bun.file(join(root, path)).exists()) {
        config = path;
        break;
      }
    }
    const cli = which(provider.cli) !== null;
    let presence: string;
    if (config && cli) presence = `repo config (${config}), CLI installed`;
    else if (config) presence = `repo config (${config}), CLI not installed`;
    else if (cli) presence = "CLI installed, no repo config";
    else continue;
    const paused = pause(records, provider.name, origin, now);
    lines.push(`${provider.name}: ${presence}${paused ? `, ${paused}` : ""}`);
  }
  return lines.length > 0 ? lines.join("\n") : "none: no bot config or CLI found locally";
}

if (import.meta.main) {
  console.log(await detect(process.cwd()));
}
