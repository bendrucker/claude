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

export const COOLDOWN_PATH = join(homedir(), ".cache", "claude", "bot-review.json");

export function parseCooldowns(text: string): Cooldown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((record): record is Cooldown => {
    if (typeof record !== "object" || record === null) return false;
    const { provider, pausedUntil, reason, remote } = record as Record<string, unknown>;
    return (
      typeof provider === "string" &&
      typeof pausedUntil === "string" &&
      typeof reason === "string" &&
      (remote === undefined || typeof remote === "string") &&
      !Number.isNaN(Date.parse(pausedUntil))
    );
  });
}

export const readCooldowns: ReadCooldowns = async () =>
  parseCooldowns(
    await Bun.file(COOLDOWN_PATH)
      .text()
      .catch(() => ""),
  );

function pause(cooldowns: Cooldown[], provider: string, remote: string | null, now: Date) {
  const live = cooldowns.filter(
    (record) =>
      record.provider === provider &&
      Date.parse(record.pausedUntil) > now.getTime() &&
      (record.remote === undefined || record.remote === remote),
  );
  if (live.length === 0) return null;
  const soonest = live.reduce((a, b) =>
    Date.parse(a.pausedUntil) <= Date.parse(b.pausedUntil) ? a : b,
  );
  const until = new Date(Date.parse(soonest.pausedUntil)).toISOString().slice(0, 10);
  return `paused until ${until} (${soonest.reason})`;
}

export interface DetectOptions {
  which?: Which;
  cooldowns?: ReadCooldowns;
  remote?: string | null;
  now?: Date;
}

export async function detect(root: string, options: DetectOptions = {}): Promise<string> {
  const { which = Bun.which, cooldowns = readCooldowns, remote = null, now = new Date() } = options;
  const records = await cooldowns();
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
    const paused = pause(records, provider.name, remote, now);
    lines.push(`${provider.name}: ${presence}${paused ? `, ${paused}` : ""}`);
  }
  return lines.length > 0 ? lines.join("\n") : "none: no bot config or CLI found locally";
}

if (import.meta.main) {
  const records = await readCooldowns();
  const origin =
    records.length > 0 ? await Bun.$`git remote get-url origin`.quiet().nothrow() : null;
  console.log(
    await detect(process.cwd(), {
      cooldowns: async () => records,
      remote: origin?.exitCode === 0 ? origin.text().trim() : null,
    }),
  );
}
