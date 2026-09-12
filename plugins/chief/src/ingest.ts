import { z } from "zod";
import { append, LEDGER_PATH, read, transition } from "./ledger";
import { nextBoundary, nextDigest, parseDuration } from "./release";
import { tier, type Event, type ReleaseRule } from "./tiers";
import type { LedgerRow, Presence } from "./types";

export const HookPayloadSchema = z.object({
  hook_event_name: z.string(),
  session_id: z.string(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  cwd: z.string().optional(),
});
export type HookPayload = z.infer<typeof HookPayloadSchema>;

export interface HerdrAgent {
  pane: string;
  agent_session: { value: string };
}

export interface HerdrAgentList {
  agents: HerdrAgent[];
}

export type ListAgents = () => Promise<HerdrAgentList>;

export async function resolvePane(
  sessionId: string,
  listAgents: ListAgents,
): Promise<string | undefined> {
  const { agents } = await listAgents();
  return agents.find((agent) => agent.agent_session.value === sessionId)?.pane;
}

const STUB_PRESENCE: Presence = {
  focus: null,
  busyUntil: null,
  activeNode: "studio",
  updatedAt: new Date(0).toISOString(),
};
const DEFAULT_WORK_HOURS: [string, string] = ["09:00", "18:00"];
const DEFAULT_GRACE_PERMISSION = "3m";

export interface IngestDeps {
  listAgents: ListAgents;
  ledgerPath?: string;
  now?: () => Date;
  presence?: Presence;
  workHours?: [string, string];
  gracePermission?: string;
}

function toEvent(payload: HookPayload): Event | null {
  switch (payload.hook_event_name) {
    case "Notification":
      return {
        hook: "Notification",
        notificationType: payload.notification_type ?? "",
        message: payload.message ?? "",
      };
    case "PermissionRequest":
      return {
        hook: "PermissionRequest",
        toolName: payload.tool_name ?? "",
        toolInput: payload.tool_input,
      };
    case "PostToolUse":
      return { hook: "PostToolUse", toolName: payload.tool_name ?? "" };
    case "Stop":
      return { hook: "Stop" };
    default:
      return null;
  }
}

function releaseAtFor(
  rule: ReleaseRule,
  now: Date,
  presence: Presence,
  workHours: [string, string],
  gracePermission: string,
): string {
  switch (rule) {
    case "immediate":
      return now.toISOString();
    case "grace-permission":
      return new Date(now.getTime() + parseDuration(gracePermission)).toISOString();
    case "boundary":
      return nextBoundary(now, presence).toISOString();
    case "digest":
      return nextDigest(now, { workHours }).toISOString();
    default:
      return now.toISOString();
  }
}

async function resolveSessionRows(
  sessionId: string,
  ledgerPath: string,
  now: Date,
  matches: (row: LedgerRow) => boolean,
): Promise<void> {
  const rows = [...(await read(ledgerPath)).values()].filter(
    (row) => row.session === sessionId && row.state === "open" && matches(row),
  );
  for (const row of rows) {
    // oxlint-disable-next-line no-await-in-loop -- transitions on the same ledger file must serialize
    await transition(row.id, { state: "resolved" }, ledgerPath, now);
  }
}

export async function ingest(
  payload: HookPayload,
  deps: IngestDeps,
): Promise<LedgerRow | undefined> {
  const ledgerPath = deps.ledgerPath ?? LEDGER_PATH;
  const now = (deps.now ?? (() => new Date()))();

  if (payload.hook_event_name === "SessionStart") {
    await resolveSessionRows(payload.session_id, ledgerPath, now, () => true);
    return undefined;
  }

  if (payload.hook_event_name === "Stop") {
    await resolveSessionRows(
      payload.session_id,
      ledgerPath,
      now,
      (row) => row.kind === "permission_prompt",
    );
  }

  const event = toEvent(payload);
  if (!event) return undefined;

  const result = tier(event);
  if (!result) return undefined;

  const pane = await resolvePane(payload.session_id, deps.listAgents);
  const key = `${payload.session_id}:${payload.notification_type ?? result.kind}`;
  const row: LedgerRow = {
    id: `claude-hook:${key}`,
    key,
    ts: now.toISOString(),
    source: "claude-hook",
    kind: result.kind,
    title: payload.message ?? payload.tool_name ?? payload.hook_event_name,
    session: payload.session_id,
    tier: result.tier,
    releaseAt: releaseAtFor(
      result.releaseAt,
      now,
      deps.presence ?? STUB_PRESENCE,
      deps.workHours ?? DEFAULT_WORK_HOURS,
      deps.gracePermission ?? DEFAULT_GRACE_PERMISSION,
    ),
    state: "open",
    reason: result.reason,
  };
  if (pane !== undefined) row.pane = pane;
  if (payload.cwd != null && payload.cwd !== "") row.payload = { cwd: payload.cwd };
  append(row, ledgerPath);
  return row;
}

async function drainLines(lines: string[], deps: IngestDeps, count: number): Promise<number> {
  const [line, ...rest] = lines;
  if (line === undefined) return count;

  let payload: HookPayload | undefined;
  try {
    payload = HookPayloadSchema.parse(JSON.parse(line));
  } catch {
    payload = undefined;
  }
  if (payload) await ingest(payload, deps);
  return drainLines(rest, deps, payload ? count + 1 : count);
}

export async function drainSpool(path: string, deps: IngestDeps): Promise<number> {
  const file = Bun.file(path);
  if (!(await file.exists())) return 0;

  const lines = (await file.text()).split("\n").filter((line) => line.trim() !== "");
  const count = await drainLines(lines, deps, 0);
  await Bun.write(path, "");
  return count;
}
