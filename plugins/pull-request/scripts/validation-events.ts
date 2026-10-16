// One record per validated PR body, in the mod-events log format, so the
// session index reads it into `mod_events` beside the mods' own events.

// oxlint-disable-next-line no-restricted-imports -- Bun has no append, and a read-then-write could drop a concurrent hook's line.
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Structure } from "./structure";

export interface Validation {
  sessionId: string;
  /** The PR command, as in `gh pr create`. */
  verb: string;
  rules: string[];
  structure: Structure;
}

export function eventsRoot(env: Record<string, string | undefined> = process.env): string {
  const config = env.CLAUDE_CONFIG_DIR;
  const base = config !== undefined && config !== "" ? config : join(homedir(), ".claude");
  return join(base, "mod-events");
}

export function validationRecord(event: Validation, at: Date): Record<string, unknown> {
  const ok = event.rules.length === 0;
  return {
    timestamp: at.toISOString(),
    severity_text: ok ? "INFO" : "WARN",
    severity_number: ok ? 9 : 13,
    event_name: "pull-request.body.validate",
    attributes: {
      verb: event.verb,
      rules: event.rules,
      ...event.structure,
      "session.id": event.sessionId,
    },
    resource: { "service.name": "claude-code" },
    scope: { name: "pull-request" },
  };
}

export async function recordValidation(event: Validation, root: string): Promise<void> {
  if (!/^[\w-]+$/.test(event.sessionId)) return;
  const dir = join(root, event.sessionId);
  try {
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify(validationRecord(event, new Date()));
    await appendFile(join(dir, "pull-request.validate.jsonl"), `${line}\n`);
  } catch (error) {
    console.error(`[pull-request/validate] validation event not recorded: ${String(error)}`);
  }
}

/** Whether an earlier validation in this session already raised the rule. */
export async function raisedBefore(
  sessionId: string,
  rule: string,
  root: string,
): Promise<boolean> {
  if (!/^[\w-]+$/.test(sessionId)) return false;
  const file = Bun.file(join(root, sessionId, "pull-request.validate.jsonl"));
  if (!(await file.exists())) return false;
  const text = await file.text();
  return text.split("\n").some((line) => line.includes(`"${rule}"`));
}
