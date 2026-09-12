import type { LedgerRow, Tier } from "./types";

export interface NtfyConfig {
  url: string;
  topic: string;
  replies: string;
  token: string;
}

const PRIORITY: Record<Tier, number> = { now: 5, boundary: 3, digest: 1 };

interface NtfyAction {
  action: "http";
  label: string;
  url: string;
  method: "POST";
  headers: { Authorization: string };
  body: string;
  clear: true;
}

function replyAction(
  label: string,
  body: Record<string, unknown>,
  repliesUrl: string,
  headers: { Authorization: string },
): NtfyAction {
  return {
    action: "http",
    label,
    url: repliesUrl,
    method: "POST",
    headers,
    body: JSON.stringify(body),
    clear: true,
  };
}

function actionsFor(row: LedgerRow, config: NtfyConfig): NtfyAction[] | undefined {
  if (row.tier !== "now" && row.tier !== "boundary") return undefined;
  const repliesUrl = `${config.url}/${config.replies}`;
  const headers = { Authorization: `Bearer ${config.token}` };
  return [
    replyAction("Hold 1h", { id: row.id, op: "hold", for: "1h" }, repliesUrl, headers),
    replyAction(
      "After meeting",
      { id: row.id, op: "hold", until: "boundary" },
      repliesUrl,
      headers,
    ),
    replyAction("Drop", { id: row.id, op: "drop" }, repliesUrl, headers),
  ];
}

export function publish(row: LedgerRow, config: NtfyConfig): Promise<Response> {
  const body: Record<string, unknown> = {
    topic: config.topic,
    title: row.title,
    message: row.reason,
    priority: PRIORITY[row.tier],
    tags: [row.kind],
  };
  const actions = actionsFor(row, config);
  if (actions) body.actions = actions;

  return fetch(`${config.url}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    body: JSON.stringify(body),
  });
}
