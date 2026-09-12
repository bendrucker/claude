import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createMcpServers, type McpServers } from "./mcp";
import { createStubStore } from "./store";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

let servers: McpServers;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeEach(async () => {
  servers = await createMcpServers(createStubStore({ startedAt: FIXED_NOW, now: () => FIXED_NOW }));
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/mcp") return servers.full.transport.handleRequest(req);
      if (url.pathname === "/node/mcp") return servers.node.transport.handleRequest(req);
      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterEach(async () => {
  await server.stop(true);
});

async function connectClient(path: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}${path}`));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamableHTTPClientTransport's sessionId getter returns string | undefined, which the SDK's own Transport interface (sessionId?: string) rejects under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  return client;
}

function isTextContent(item: unknown): item is { type: "text"; text: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "text" &&
    "text" in item &&
    typeof item.text === "string"
  );
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error("result has no content array");
  }
  const item = result.content.find(isTextContent);
  if (!item) throw new Error("no text content in result");
  return item.text;
}

test("full path lists every tool", async () => {
  const client = await connectClient("/mcp");
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).toSorted()).toEqual([
    "ack",
    "append",
    "dispatch",
    "hold",
    "inbox",
    "status",
    "why",
  ]);
});

test("node path lists only append and status", async () => {
  const client = await connectClient("/node/mcp");
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).toSorted()).toEqual(["append", "status"]);
});

test("node path refuses hold", async () => {
  const client = await connectClient("/node/mcp");
  const result = await client.callTool({ name: "hold", arguments: { id: "x" } });
  expect(result.isError).toBe(true);
});

test("inbox returns the stub row", async () => {
  const client = await connectClient("/mcp");
  const result = await client.callTool({ name: "inbox", arguments: {} });
  expect(JSON.parse(textOf(result))).toMatchInlineSnapshot(`
    [
      {
        "id": "claude-hook:s1:idle_prompt",
        "key": "s1:idle_prompt",
        "kind": "idle",
        "reason": "idle_prompt notification",
        "releaseAt": "2026-01-02T08:00:00.000Z",
        "session": "s1",
        "source": "claude-hook",
        "state": "open",
        "tier": "digest",
        "title": "session idle",
        "ts": "2026-01-01T00:00:00.000Z",
      },
    ]
  `);
});

test("status via node path reports counts", async () => {
  const client = await connectClient("/node/mcp");
  const result = await client.callTool({ name: "status", arguments: {} });
  expect(JSON.parse(textOf(result))).toMatchInlineSnapshot(`
    {
      "counts": {
        "boundary": {
          "acked": 0,
          "dropped": 0,
          "held": 0,
          "open": 0,
          "pushed": 0,
          "resolved": 0,
        },
        "digest": {
          "acked": 0,
          "dropped": 0,
          "held": 0,
          "open": 1,
          "pushed": 0,
          "resolved": 0,
        },
        "now": {
          "acked": 0,
          "dropped": 0,
          "held": 0,
          "open": 0,
          "pushed": 0,
          "resolved": 0,
        },
      },
      "daemonUptimeMs": 0,
      "lastDoorbell": null,
      "presence": {
        "activeNode": "studio",
        "busyUntil": null,
        "focus": null,
        "updatedAt": "1970-01-01T00:00:00.000Z",
      },
    }
  `);
});
