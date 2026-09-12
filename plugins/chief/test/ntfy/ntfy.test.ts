import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { publish, type NtfyConfig } from "../../src/ntfy";
import type { LedgerRow } from "../../src/types";
import { NTFY_AVAILABLE, startServer, stopServer, type TestServer } from "./harness";

const NtfyMessage = z.looseObject({
  event: z.string(),
  title: z.string().optional(),
  message: z.string().optional(),
  priority: z.number().optional(),
  tags: z.array(z.string()).optional(),
  actions: z.array(z.unknown()).optional(),
});
type NtfyMessage = z.infer<typeof NtfyMessage>;

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "claude-hook:sess-1:permission_prompt",
    key: "sess-1:permission_prompt",
    ts: "2026-09-12T00:00:00.000Z",
    source: "claude-hook",
    kind: "permission_prompt",
    title: "Approve tool use?",
    tier: "boundary",
    releaseAt: "2026-09-12T00:03:00.000Z",
    state: "open",
    reason: "permission_prompt notification",
    ...overrides,
  };
}

async function nextMessage(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: string,
): Promise<NtfyMessage> {
  const newlineIndex = buffer.indexOf("\n");
  if (newlineIndex === -1) {
    const { value, done } = await reader.read();
    if (done) throw new Error("ntfy stream ended before a message arrived");
    return nextMessage(reader, decoder, buffer + decoder.decode(value, { stream: true }));
  }

  const line = buffer.slice(0, newlineIndex);
  const rest = buffer.slice(newlineIndex + 1);
  if (line.trim() === "") return nextMessage(reader, decoder, rest);

  const parsed = NtfyMessage.parse(JSON.parse(line));
  if (parsed.event === "open" || parsed.event === "keepalive")
    return nextMessage(reader, decoder, rest);

  await reader.cancel();
  return parsed;
}

async function firstMessage(url: string, topic: string, token: string): Promise<NtfyMessage> {
  const response = await fetch(`${url}/${topic}/json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("no response body from ntfy subscribe");
  return nextMessage(reader, new TextDecoder(), "");
}

describe.skipIf(!NTFY_AVAILABLE)("publish", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await stopServer(server);
  });

  test("delivers what the phone receives, with reply actions on a boundary row", async () => {
    const config: NtfyConfig = {
      url: server.url,
      topic: "chief-boundary",
      replies: "chief-replies",
      token: server.token,
    };
    const phone = firstMessage(config.url, config.topic, config.token);
    await Bun.sleep(200);

    const response = await publish(row(), config);
    expect(response.ok).toBe(true);

    const message = await phone;
    expect(message.title).toBe("Approve tool use?");
    expect(message.message).toBe("permission_prompt notification");
    expect(message.priority).toBe(3);
    expect(message.tags).toEqual(["permission_prompt"]);

    const repliesUrl = `${config.url}/${config.replies}`;
    const headers = { Authorization: `Bearer ${config.token}` };
    expect(message.actions).toMatchObject([
      {
        action: "http",
        label: "Hold 1h",
        url: repliesUrl,
        method: "POST",
        headers,
        body: JSON.stringify({ id: row().id, op: "hold", for: "1h" }),
        clear: true,
      },
      {
        action: "http",
        label: "After meeting",
        url: repliesUrl,
        method: "POST",
        headers,
        body: JSON.stringify({ id: row().id, op: "hold", until: "boundary" }),
        clear: true,
      },
      {
        action: "http",
        label: "Drop",
        url: repliesUrl,
        method: "POST",
        headers,
        body: JSON.stringify({ id: row().id, op: "drop" }),
        clear: true,
      },
    ]);
  });

  test("omits reply actions on a digest row", async () => {
    const config: NtfyConfig = {
      url: server.url,
      topic: "chief-digest",
      replies: "chief-replies",
      token: server.token,
    };
    const phone = firstMessage(config.url, config.topic, config.token);
    await Bun.sleep(200);

    await publish(
      row({ tier: "digest", kind: "stop", id: "claude-hook:sess-1:stop", reason: "session Stop" }),
      config,
    );

    const message = await phone;
    expect(message.priority).toBe(1);
    expect(message.actions).toBeUndefined();
  });
});
