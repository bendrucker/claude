// A durable swap needs rename(2), and a stale-lock check needs a directory's
// mtime. Bun's file API exposes neither. mkdir and rm are allowed outright, so
// sharing the statement grants them nothing.
// oxlint-disable-next-line no-restricted-imports
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { decodeJson } from "../../../../packages/decode/index";

export interface Deferral {
  readonly reason: string;
  readonly since: string;
}

export type Deferrals = Record<string, Deferral>;

const StoredDeferrals = z.record(
  z.string(),
  z.looseObject({ reason: z.string().optional(), since: z.string().optional() }),
);

export function deferredPath(env: Record<string, string | undefined>): string {
  const cache = env.XDG_CACHE_HOME ?? join(env.HOME ?? "", ".cache");
  return join(cache, "claude", "flock", "deferred.json");
}

export function parseDeferrals(text: string): Deferrals {
  if (text.trim() === "") return {};
  const stored = decodeJson(StoredDeferrals, text, "flock deferred.json");
  return Object.fromEntries(
    Object.entries(stored).map(([key, value]) => [
      key,
      { reason: value.reason ?? "no reason recorded", since: value.since ?? "9999-99-99" },
    ]),
  );
}

export function record(current: Deferrals, key: string, reason: string, today: string): Deferrals {
  return { ...current, [key]: { reason, since: today } };
}

export function drop(current: Deferrals, key: string): Deferrals {
  const { [key]: _removed, ...rest } = current;
  return rest;
}

export function staleKeys(deferrals: Deferrals, cutoff: string): string[] {
  return Object.keys(deferrals).filter((key) => (deferrals[key]?.since ?? "9999-99-99") < cutoff);
}

export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function daysBefore(at: Date, days: number): string {
  return isoDate(new Date(at.getTime() - days * 86_400_000));
}

const LOCK_STALE_MS = 120_000;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

async function lockAgeMs(lock: string): Promise<number | null> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs;
  } catch {
    return null;
  }
}

async function acquire(lock: string, deadline: number): Promise<void> {
  try {
    await mkdir(lock);
    return;
  } catch {
    // Held by another writer, or left behind by one that died.
  }

  const age = await lockAgeMs(lock);
  if (age !== null && age > LOCK_STALE_MS) {
    await rm(lock, { recursive: true, force: true });
    return acquire(lock, deadline);
  }
  if (Date.now() >= deadline) throw new Error(`another writer holds ${lock}`);
  await Bun.sleep(LOCK_RETRY_MS);
  return acquire(lock, deadline);
}

async function readCurrent(path: string): Promise<Deferrals> {
  const file = Bun.file(path);
  return (await file.exists()) ? parseDeferrals(await file.text()) : {};
}

/**
 * Read-modify-write without this lock loses an entry whenever two deferrals
 * are recorded at once, and a partial write leaves the file unparseable for
 * the next board load.
 */
export async function updateDeferrals(
  path: string,
  mutate: (current: Deferrals) => Deferrals,
): Promise<Deferrals> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const lock = join(dir, ".lock");
  await acquire(lock, Date.now() + LOCK_TIMEOUT_MS);

  try {
    const next = mutate(await readCurrent(path));
    const temp = join(dir, `.deferred.${process.pid}.${Math.random().toString(36).slice(2)}.json`);
    await Bun.write(temp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(temp, path);
    return next;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function readDeferrals(path: string): Promise<Deferrals> {
  return readCurrent(path);
}
