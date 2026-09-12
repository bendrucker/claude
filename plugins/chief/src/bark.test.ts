import { createDecipheriv } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { actToken } from "./act";
import { publish, type BarkConfig } from "./bark";
import type { LedgerRow, Tier } from "./types";

const KEY = "0123456789abcdef";
const SECRET = "act-test-secret";

const PushRequestSchema = z.object({
  device_keys: z.array(z.string()),
  ciphertext: z.string(),
  iv: z.string(),
});
type PushRequest = z.infer<typeof PushRequestSchema>;

const PlainPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  level: z.string(),
  group: z.string(),
  url: z.string(),
});

function decrypt(push: PushRequest, key: string): z.infer<typeof PlainPayloadSchema> {
  const keyBuffer = Buffer.from(key, "utf8");
  const algorithm = keyBuffer.length === 16 ? "aes-128-cbc" : "aes-256-cbc";
  const decipher = createDecipheriv(algorithm, keyBuffer, Buffer.from(push.iv, "utf8"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(push.ciphertext, "base64")),
    decipher.final(),
  ]);
  return PlainPayloadSchema.parse(JSON.parse(plain.toString("utf8")));
}

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "claude-hook:s1:permission_prompt",
    key: "s1:permission_prompt",
    ts: "2026-01-01T09:00:00.000Z",
    source: "claude-hook",
    kind: "permission_prompt",
    title: "Approve tool use?",
    pane: "%1",
    tier: "boundary",
    releaseAt: "2026-01-01T09:03:00.000Z",
    state: "open",
    reason: "permission_prompt notification",
    ...overrides,
  };
}

let server: ReturnType<typeof Bun.serve>;
let received: PushRequest[];
let config: BarkConfig;

beforeEach(() => {
  received = [];
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (new URL(req.url).pathname !== "/push") return new Response("not found", { status: 404 });
      received.push(PushRequestSchema.parse(await req.json()));
      return Response.json({ code: 200 });
    },
  });
  config = {
    url: `http://127.0.0.1:${server.port}`,
    devices: ["device-1"],
    key: KEY,
    actUrl: "https://chief.tailnet:7392",
  };
});

afterEach(async () => {
  await server.stop(true);
});

test("publish posts the encrypted plain payload and the act url", async () => {
  await publish(row(), config, SECRET);

  expect(received).toHaveLength(1);
  const push = received[0]!;
  expect(push.device_keys).toEqual(["device-1"]);
  expect(decrypt(push, KEY)).toEqual({
    title: "Approve tool use?",
    body: "permission_prompt · %1 · permission_prompt notification",
    level: "timeSensitive",
    group: "chief",
    url: `https://chief.tailnet:7392/act/claude-hook:s1:permission_prompt?t=${actToken(row().id, SECRET)}`,
  });
});

test.each<{ tier: Tier; level: string }>([
  { tier: "now", level: "critical" },
  { tier: "boundary", level: "timeSensitive" },
  { tier: "digest", level: "passive" },
])("$tier tier publishes at level $level", async ({ tier, level }) => {
  await publish(row({ tier }), config, SECRET);
  expect(decrypt(received[0]!, KEY).level).toBe(level);
});

test("publish fans out to every configured device in one push", async () => {
  await publish(row(), { ...config, devices: ["device-1", "device-2"] }, SECRET);
  expect(received[0]!.device_keys).toEqual(["device-1", "device-2"]);
});

test("publish does nothing when no devices are configured", async () => {
  await publish(row(), { ...config, devices: [] }, SECRET);
  expect(received).toHaveLength(0);
});

test("publish logs and does not throw on a non-2xx response", async () => {
  await server.stop(true);
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("nope", { status: 500 }),
  });
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    await publish(row(), { ...config, url: `http://127.0.0.1:${server.port}` }, SECRET);
  } finally {
    console.error = originalError;
  }
  expect(errors).toEqual([["bark publish", 500, row().id]]);
});
