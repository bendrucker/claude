import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Store } from "./store";

const TierSchema = z.enum(["now", "boundary", "digest"]);
const StateSchema = z.enum(["open", "held", "pushed", "acked", "resolved", "dropped"]);

function textResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function registerNodeTools(server: McpServer, store: Store): void {
  server.registerTool(
    "append",
    {
      title: "Append",
      description: "Append a ledger row from the node, tiered by the table",
      inputSchema: {
        key: z.string(),
        kind: z.string(),
        title: z.string(),
        payload: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (args) => textResult(await store.append(args)),
  );

  server.registerTool(
    "status",
    {
      title: "Status",
      description: "Presence, counts per tier and state, daemon uptime, last doorbell result",
      inputSchema: {},
    },
    async () => textResult(await store.status()),
  );
}

function registerFullTools(server: McpServer, store: Store): void {
  registerNodeTools(server, store);

  server.registerTool(
    "inbox",
    {
      title: "Inbox",
      description: "Rows newest first, default open+held+pushed",
      inputSchema: { tier: TierSchema.optional(), state: StateSchema.optional(), limit: z.number().optional() },
    },
    async (args) => textResult(await store.inbox(args)),
  );

  server.registerTool(
    "hold",
    {
      title: "Hold",
      description: "Hold a row for a duration, or until a boundary, digest, or ISO time",
      inputSchema: {
        id: z.string(),
        for: z.enum(["1h", "3h", "1d"]).optional(),
        until: z.string().optional(),
      },
    },
    async (args) => textResult(await store.hold(args)),
  );

  server.registerTool(
    "ack",
    {
      title: "Ack",
      description: "Acknowledge a row and record the decision",
      inputSchema: { id: z.string(), note: z.string().optional() },
    },
    async (args) => textResult(await store.ack(args)),
  );

  server.registerTool(
    "dispatch",
    {
      title: "Dispatch",
      description: "Dispatch text to a node as a boundary-tier row",
      inputSchema: { text: z.string(), target: z.literal("studio").optional() },
    },
    async (args) => textResult(await store.dispatch(args)),
  );

  server.registerTool(
    "why",
    {
      title: "Why",
      description: "A row's history lines and the tier reason",
      inputSchema: { id: z.string() },
    },
    async (args) => textResult(await store.why(args)),
  );
}

export interface McpEndpoint {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

export interface McpServers {
  full: McpEndpoint;
  node: McpEndpoint;
}

async function connectedEndpoint(build: (server: McpServer) => void): Promise<McpEndpoint> {
  const server = new McpServer({ name: "chief", version: "0.0.0" });
  build(server);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  await server.connect(transport);
  return { server, transport };
}

export async function createMcpServers(store: Store): Promise<McpServers> {
  const [full, node] = await Promise.all([
    connectedEndpoint((server) => registerFullTools(server, store)),
    connectedEndpoint((server) => registerNodeTools(server, store)),
  ]);
  return { full, node };
}
