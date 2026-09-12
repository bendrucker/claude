export type Tier = "now" | "boundary" | "digest";
export type Source = "claude-hook" | "herdr" | "phone" | "manual";

export interface LedgerRow {
  id: string; // stable identity: `${source}:${key}`
  key: string; // e.g. `${session_id}:${notification_type}`, dedupes pushes per (row, state)
  ts: string; // ISO, when this line was written
  source: Source;
  kind: string; // "permission_prompt" | "ask_user" | "idle" | "stop" | "credential" | "dispatch" | "presence"
  title: string; // one line, from the hook's message or herdr's terminal_title_stripped
  session?: string; // Claude session id
  pane?: string; // herdr pane id, resolved from `herdr agent list` by session id
  tier: Tier;
  releaseAt: string; // ISO; "now" rows get ts
  state: "open" | "held" | "pushed" | "acked" | "resolved" | "dropped";
  reason: string; // why this tier, shown by `why`
  payload?: Record<string, unknown>;
}

export interface Presence {
  focus: string | null; // mode name from Assertions.json + ModeConfigurations.json, null when none
  busyUntil: string | null; // end of the current calendar event
  activeNode: string; // "studio" or a node name; keyboard idle under 5 min wins
  updatedAt: string;
}
