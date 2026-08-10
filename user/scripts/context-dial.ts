#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join } from "node:path";

// herdr strips control bytes out of reported token values, so a pre-colored
// value cannot survive: the escape is dropped and its `[32m` residue renders as
// text. The dial's color therefore has to be the token's *name*, which herdr's
// sidebar config styles per name. One name carries the glyph at a time and the
// rest are cleared, so the four here mirror the four `dialColor` levels.
export const CONTEXT_TOKENS = ["ctx_low", "ctx_mid", "ctx_high", "ctx_crit"] as const;

export type ContextToken = (typeof CONTEXT_TOKENS)[number];

export interface DialReport {
  token: ContextToken;
  value: string;
}

interface CachedReport {
  sig: string;
  at: number;
}

const SOURCE = "claude-statusline";
const TTL_MS = 86_400_000;
const REFRESH_MS = 3_600_000;
const HERDR_TIMEOUT_MS = 5_000;
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g;

export function cachePath(sessionId: string): string {
  return join(tmpdir(), "claude-context-dial", `${sessionId.replace(UNSAFE_NAME, "-")}.json`);
}

export function shouldReport(cached: CachedReport | null, sig: string, now: number): boolean {
  if (!cached || cached.sig !== sig) return true;
  // A herdr restart drops every reported token, and an unconditional cache hit
  // would leave the sidebar blank until the dial next moves, which can be hours.
  return now - cached.at >= REFRESH_MS;
}

export function reportArgs(paneId: string, report: DialReport): string[] {
  const args = [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    SOURCE,
    "--ttl-ms",
    String(TTL_MS),
    "--token",
    `${report.token}=${report.value}`,
  ];
  for (const name of CONTEXT_TOKENS) {
    if (name !== report.token) args.push("--clear-token", name);
  }
  return args;
}

// `agent_session.value` is the Claude session UUID herdr's integration hook
// reports, which makes the pane match exact where cwd or title would guess.
export function findPane(paneList: string, sessionId: string): string | null {
  let parsed: {
    result?: { panes?: Array<{ pane_id?: string; agent_session?: { value?: string } }> };
  };
  try {
    parsed = JSON.parse(paneList);
  } catch {
    return null;
  }
  const pane = parsed.result?.panes?.find((p) => p.agent_session?.value === sessionId);
  return pane?.pane_id ?? null;
}

async function readCache(path: string): Promise<CachedReport | null> {
  try {
    const cached = JSON.parse(await Bun.file(path).text()) as CachedReport;
    return typeof cached.sig === "string" && typeof cached.at === "number" ? cached : null;
  } catch {
    return null;
  }
}

// Called on every status line render, so the steady state has to be a file read
// and nothing else. Only a changed dial reaches herdr, and it reaches it through
// a detached child: the status line must render at the same speed whether herdr
// is fast, slow, or not running.
export async function reportContextDial(sessionId: string, report: DialReport): Promise<void> {
  if (!process.env.HERDR_PANE_ID) return;

  const sig = `${report.token}=${report.value}`;
  const path = cachePath(sessionId);
  if (!shouldReport(await readCache(path), sig, Date.now())) return;

  // The cache records the attempt rather than the outcome. A herdr that is down
  // would otherwise turn every later render back into a spawn.
  await Bun.write(path, JSON.stringify({ sig, at: Date.now() }));

  Bun.spawn([process.execPath, import.meta.path, sessionId, report.token, report.value], {
    stdio: ["ignore", "ignore", "ignore"],
  }).unref();
}

function parseToken(value: string | undefined): ContextToken | null {
  return CONTEXT_TOKENS.find((token) => token === value) ?? null;
}

if (import.meta.main) {
  const [sessionId, token, value] = process.argv.slice(2);
  const name = parseToken(token);
  if (sessionId && name && value) {
    const list = Bun.spawnSync(["herdr", "pane", "list"], { timeout: HERDR_TIMEOUT_MS });
    const paneId = list.success ? findPane(list.stdout.toString(), sessionId) : null;
    if (paneId) {
      Bun.spawnSync(["herdr", ...reportArgs(paneId, { token: name, value })], {
        timeout: HERDR_TIMEOUT_MS,
      });
    }
  }
}
