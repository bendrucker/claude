export type ItemKind = "prompt" | "text" | "tool_use" | "tool_result";

export interface TranscriptItem {
  kind: ItemKind;
  name: string | null;
  text: string;
}

export const RESULT_LIMIT = 1_500;
export const PREFIX_LIMIT = 60_000;

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const high = text.charCodeAt(limit - 1);
  const end = high >= 0xd8_00 && high <= 0xdb_ff ? limit - 1 : limit;
  return `${text.slice(0, end)}\n[truncated ${text.length - end} chars]`;
}

function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

function toolCall(name: string | null, text: string): string {
  const input = text === "" ? "" : ` \`${text.replaceAll("`", "'").replaceAll("\n", " ")}\``;
  return `**Tool call** \`${name ?? "unknown"}\`:${input}`;
}

const marker = (n: number): string => `[... ${n} earlier items omitted ...]`;

export function renderItem(item: TranscriptItem): string {
  const text = item.text.trim();
  switch (item.kind) {
    case "prompt":
      return `## User\n\n${text}`;
    case "text":
      return `## Assistant\n\n${text}`;
    case "tool_use":
      return toolCall(item.name, text);
    case "tool_result":
      return `**Result**\n\n${fenced(truncate(text, RESULT_LIMIT))}`;
    default:
      return text;
  }
}

/**
 * Renders the items as a markdown transcript under `limit` chars. Over the limit, the first
 * user prompt stays, the middle drops, and the tail that fits remains.
 */
export function renderPrefix(items: readonly TranscriptItem[], limit = PREFIX_LIMIT): string {
  const chunks = items.map(renderItem);
  const joined = chunks.join("\n\n");
  if (joined.length <= limit) return joined;

  const first = Math.max(
    0,
    items.findIndex((i) => i.kind === "prompt"),
  );
  const head = chunks[first] ?? "";
  let budget = limit - head.length - marker(chunks.length).length - 4;
  let start = chunks.length;
  while (start - 1 > first) {
    const cost = (chunks[start - 1]?.length ?? 0) + 2;
    if (cost > budget) break;
    budget -= cost;
    start -= 1;
  }
  const tail = chunks.slice(start);
  return [head, marker(start - first - 1), ...tail].join("\n\n");
}
