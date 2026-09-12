import { z } from "zod";
import type { NtfyConfig } from "./ntfy";

const ReplySchema = z.object({
  id: z.string(),
  op: z.string(),
  for: z.string().optional(),
  until: z.string().optional(),
});
export type Reply = z.infer<typeof ReplySchema>;

const NtfyLineSchema = z.object({
  event: z.string(),
  message: z.string().optional(),
});

export type OnReply = (reply: Reply) => void;
export type Fetch = typeof fetch;
export type Sleep = (ms: number) => Promise<void>;

export const RECONNECT_BACKOFF_MS = [1_000, 5_000, 15_000, 30_000];

function parseLine(line: string, onReply: OnReply): void {
  if (line.trim() === "") return;

  let ntfyLine: z.infer<typeof NtfyLineSchema>;
  try {
    ntfyLine = NtfyLineSchema.parse(JSON.parse(line));
  } catch {
    return;
  }
  if (ntfyLine.event === "open" || ntfyLine.event === "keepalive") return;
  if (ntfyLine.message === undefined) return;

  let reply: Reply;
  try {
    reply = ReplySchema.parse(JSON.parse(ntfyLine.message));
  } catch {
    return;
  }
  onReply(reply);
}

async function consume(response: Response, onReply: OnReply): Promise<void> {
  const body = response.body;
  if (!body) return;

  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) parseLine(line, onReply);
  }
}

export interface SubscribeOptions {
  fetch?: Fetch;
  sleep?: Sleep;
  backoff?: number[];
  signal?: AbortSignal;
}

async function loop(
  config: NtfyConfig,
  onReply: OnReply,
  fetchImpl: Fetch,
  sleep: Sleep,
  backoff: number[],
  signal: AbortSignal,
  attempt: number,
): Promise<void> {
  if (signal.aborted) return;

  try {
    const response = await fetchImpl(`${config.url}/${config.replies}/json`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal,
    });
    await consume(response, onReply);
  } catch {
    // connection dropped or refused. fall through to reconnect.
  }

  const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 30_000;
  await sleep(delay);
  return loop(config, onReply, fetchImpl, sleep, backoff, signal, attempt + 1);
}

export function subscribe(
  config: NtfyConfig,
  onReply: OnReply,
  opts: SubscribeOptions = {},
): () => void {
  const controller = new AbortController();
  const signal = opts.signal ?? controller.signal;
  void loop(
    config,
    onReply,
    opts.fetch ?? fetch,
    opts.sleep ?? ((ms) => Bun.sleep(ms)),
    opts.backoff ?? RECONNECT_BACKOFF_MS,
    signal,
    0,
  );
  return () => controller.abort();
}
