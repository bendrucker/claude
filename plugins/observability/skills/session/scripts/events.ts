// One record per refresh or query, in the mod-events log format, so the index reads its
// own telemetry into `mod_events` beside the mods' events.

// oxlint-disable-next-line no-restricted-imports -- Bun has no append, and a read-then-write could drop a concurrent run's line.
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export interface IndexEvent {
  event: "refresh" | "query";
  ok: boolean;
  ms: number;
  detail: Record<string, unknown>;
}

export function eventsRoot(env: Env = process.env): string {
  const config = env.CLAUDE_CONFIG_DIR;
  const base = config !== undefined && config !== "" ? config : join(homedir(), ".claude");
  return join(base, "mod-events");
}

// A terminal or nightly run has no session, and dropping it would hide the runs that
// carry the heaviest refreshes.
function sessionOf(env: Env): string | undefined {
  const id = env.CLAUDE_CODE_SESSION_ID;
  return id !== undefined && /^[\w-]+$/.test(id) ? id : undefined;
}

export function eventRecord(
  event: IndexEvent,
  at: Date,
  sessionId?: string,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    ...event.detail,
    duration_ms: Math.round(event.ms),
  };
  if (sessionId !== undefined) attributes["session.id"] = sessionId;
  return {
    timestamp: at.toISOString(),
    severity_text: event.ok ? "INFO" : "WARN",
    severity_number: event.ok ? 9 : 13,
    event_name: `session-index.${event.event}`,
    attributes,
    resource: { "service.name": "claude-code" },
    scope: { name: "session-index" },
  };
}

/** The DuckDB error class (`Binder Error`), or the first line of anything else. */
export function errorClass(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return /^\w+ Error\b/.exec(text)?.[0] ?? (text.split("\n")[0] ?? "").slice(0, 120);
}

// Skipped under `bun test`, whose fixture indexes would otherwise land in the live log.
export async function emit(event: IndexEvent, env: Env = process.env): Promise<void> {
  if (env.NODE_ENV === "test") return;
  const at = new Date();
  const sessionId = sessionOf(env);
  const dir = join(eventsRoot(env), sessionId ?? "cli");
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(eventRecord(event, at, sessionId));
    await appendFile(
      join(dir, `session-index.${at.toISOString().slice(0, 10)}.jsonl`),
      `${line}\n`,
    );
  } catch (error) {
    console.error(`session index: ${event.event} event not recorded: ${String(error)}`);
  }
}
