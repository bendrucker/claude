#!/usr/bin/env bun
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { brandGlyph } from "./glyphs";

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

const CachedReport = z.object({
  sig: z.string(),
  at: z.number(),
});
type CachedReport = z.infer<typeof CachedReport>;

const SOURCE = "claude-statusline";
const TTL_MS = 86_400_000;
const REFRESH_MS = 3_600_000;
const HERDR_TIMEOUT_MS = 5_000;
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/g;

export function cachePath(sessionId: string): string {
  return join(tmpdir(), "claude-pane-metadata", `${sessionId.replace(UNSAFE_NAME, "-")}.json`);
}

export function shouldReport(cached: CachedReport | null, sig: string, now: number): boolean {
  if (!cached || cached.sig !== sig) return true;
  // A herdr restart drops every reported token, and an unconditional cache hit
  // would leave the sidebar blank until the dial next moves, which can be hours.
  return now - cached.at >= REFRESH_MS;
}

export function reportSignature(report: DialReport | null): string {
  return `${brandGlyph}:${report ? `${report.token}=${report.value}` : ""}`;
}

// The brand mark rides along on the dial's call rather than getting one of its
// own, because it needs exactly what the dial already has: a report that repeats.
// herdr holds pane metadata in the server's memory, so every restart drops it,
// and the nightly `dotfiles-upgrade` restarts the server to install plugins.
// Reported once at SessionStart, the mark never comes back, and a session that
// was already open shows herdr's own robot for the rest of its life.
//
// The dial is optional so that riding along costs the mark nothing:
// `context_window` is absent until a turn has closed, and the pane should be
// branded before then.
export function reportArgs(paneId: string, report: DialReport | null): string[] {
  const args = [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    SOURCE,
    "--ttl-ms",
    String(TTL_MS),
    "--display-agent",
    brandGlyph,
  ];
  if (!report) return args;

  args.push("--token", `${report.token}=${report.value}`);
  for (const name of CONTEXT_TOKENS) {
    if (name !== report.token) args.push("--clear-token", name);
  }
  return args;
}

// `agent_session.value` is the Claude session UUID herdr's integration hook
// reports, which makes the pane match exact where cwd or title would guess.
const PaneList = z.looseObject({
  result: z
    .looseObject({
      panes: z
        .array(
          z.looseObject({
            pane_id: z.string().optional().catch(undefined),
            agent_session: z
              .looseObject({ value: z.string().optional().catch(undefined) })
              .optional()
              .catch(undefined),
          }),
        )
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

export function findPane(paneList: string, sessionId: string): string | null {
  let parsed: z.infer<typeof PaneList>;
  try {
    parsed = PaneList.parse(JSON.parse(paneList));
  } catch {
    return null;
  }
  const pane = parsed.result?.panes?.find((p) => p.agent_session?.value === sessionId);
  return pane?.pane_id ?? null;
}

async function readCache(path: string): Promise<CachedReport | null> {
  try {
    return CachedReport.parse(await Bun.file(path).json());
  } catch {
    return null;
  }
}

// Called on every status line render, so the steady state has to be a file read
// and nothing else. Only a changed report reaches herdr, and it reaches it
// through a detached child: the status line must render at the same speed
// whether herdr is fast, slow, or not running.
export async function reportPaneMetadata(
  sessionId: string,
  report: DialReport | null,
): Promise<void> {
  const paneId = process.env.HERDR_PANE_ID;
  if (paneId == null || paneId === "") return;

  const sig = reportSignature(report);
  const path = cachePath(sessionId);
  if (!shouldReport(await readCache(path), sig, Date.now())) return;

  // The cache records the attempt rather than the outcome. A herdr that is down
  // would otherwise turn every later render back into a spawn.
  await Bun.write(path, JSON.stringify({ sig, at: Date.now() }));

  const argv = [process.execPath, import.meta.path, sessionId];
  if (report) argv.push(report.token, report.value);
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"] }).unref();
}

function parseToken(value: string | undefined): ContextToken | null {
  return CONTEXT_TOKENS.find((token) => token === value) ?? null;
}

if (import.meta.main) {
  const [sessionId, token, value] = process.argv.slice(2);
  const name = parseToken(token);
  if (sessionId != null && sessionId !== "") {
    const list = Bun.spawnSync(["herdr", "pane", "list"], { timeout: HERDR_TIMEOUT_MS });
    const paneId = list.success ? findPane(list.stdout.toString(), sessionId) : null;
    if (paneId != null && paneId !== "") {
      const report =
        name != null && name !== "" && value != null && value !== "" ? { token: name, value } : null;
      Bun.spawnSync(["herdr", ...reportArgs(paneId, report)], { timeout: HERDR_TIMEOUT_MS });
    }
  }
}
