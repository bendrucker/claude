#!/usr/bin/env bun
// Spool appends need O_APPEND atomicity across concurrent hook invocations;
// Bun.write's read-modify-write would drop concurrent lines.
// oxlint-disable-next-line no-restricted-imports
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const INGEST_URL = "http://127.0.0.1:7391/ingest";
export const SPOOL_PATH = join(homedir(), ".local", "state", "chief", "ingest.spool.jsonl");
const TIMEOUT_MS = 500;

export function spool(body: string, path: string = SPOOL_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${body}\n`);
}

export async function tap(
  body: string,
  url: string = INGEST_URL,
  spoolPath: string = SPOOL_PATH,
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) spool(body, spoolPath);
  } catch {
    spool(body, spoolPath);
  }
}

if (import.meta.main) {
  try {
    await tap(await Bun.stdin.text());
  } catch {
    // fall through to the unconditional exit
  }
  process.exit(0);
}
