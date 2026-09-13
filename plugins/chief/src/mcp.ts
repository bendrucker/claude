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
      inputSchema: {
        tier: TierSchema.optional(),
        state: StateSchema.optional(),
        limit: z.number().optional(),
      },
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
    async (args) => textResult(await store.hold({ ...args, actor: "chief" })),
  );

  server.registerTool(
    "ack",
    {
      title: "Ack",
      description: "Acknowledge a row and record the decision",
      inputSchema: { id: z.string(), note: z.string().optional() },
    },
    async (args) => textResult(await store.ack({ ...args, actor: "chief" })),
  );

  server.registerTool(
    "drop",
    {
      title: "Drop",
      description: "Drop a row, same as the phone's Drop button",
      inputSchema: { id: z.string() },
    },
    async (args) => textResult(await store.drop({ ...args, actor: "chief" })),
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
  handleRequest(req: Request): Promise<Response>;
}

export interface McpServers {
  full: McpEndpoint;
  node: McpEndpoint;
}

// One server and transport per request: a stateful transport binds to its first client and rejects
// every later initialize, and the SDK's stateless transport refuses reuse across requests. The daemon
// outlives many bridge and tailgate clients, and registering a handful of tools per request is cheap.
function statelessEndpoint(build: (server: McpServer) => void): McpEndpoint {
  return {
    async handleRequest(req) {
      const server = new McpServer({ name: "chief", version: "0.0.0" });
      build(server);
      const transport = new WebStandardStreamableHTTPServerTransport({});
      await server.connect(transport);
      return transport.handleRequest(req);
    },
  };
}

export function createMcpServers(store: Store): McpServers {
  return {
    full: statelessEndpoint((server) => registerFullTools(server, store)),
    node: statelessEndpoint((server) => registerNodeTools(server, store)),
  };
}
