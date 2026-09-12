import { z } from "zod";
import { ingest, type HerdrAgentList, type HookPayload, type IngestDeps } from "./ingest";
import { createMcpServers, type McpServers } from "./mcp";
import type { Store } from "./store";

const PORT = 7391;

function hasAllowedHost(req: Request, allowedHosts: Set<string>): boolean {
  return allowedHosts.has(req.headers.get("host") ?? "");
}

const IngestBodySchema = z.object({
  hook_event_name: z.string(),
  session_id: z.string(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  cwd: z.string().optional(),
});

export const HerdrAgentListSchema = z.object({
  agents: z.array(z.object({ pane: z.string(), agent_session: z.object({ value: z.string() }) })),
});

export async function herdrListAgents(): Promise<HerdrAgentList> {
  const proc = Bun.spawn(["herdr", "agent", "list"], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return HerdrAgentListSchema.parse(JSON.parse(output));
}

async function handleIngest(
  req: Request,
  deps: IngestDeps,
  allowedHosts: Set<string>,
): Promise<Response> {
  if (!hasAllowedHost(req, allowedHosts)) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const parsed = IngestBodySchema.safeParse(body);
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const payload: HookPayload = parsed.data;
  const row = await ingest(payload, deps);
  return Response.json(row ?? null);
}

export interface ChiefServerDeps {
  store: Store;
  ingestDeps: IngestDeps;
  startedAt?: Date;
}

export interface ChiefServerOptions {
  port?: number;
  hostname?: string;
}

export interface ChiefServer {
  server: ReturnType<typeof Bun.serve>;
  mcp: McpServers;
}

export async function startServer(
  deps: ChiefServerDeps,
  options: ChiefServerOptions = {},
): Promise<ChiefServer> {
  const mcp = await createMcpServers(deps.store);
  const startedAt = deps.startedAt ?? new Date();
  const port = options.port ?? PORT;
  let allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = Bun.serve({
    port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/mcp":
          return mcp.full.transport.handleRequest(req);
        case "/node/mcp":
          return mcp.node.transport.handleRequest(req);
        case "/ingest":
          return handleIngest(req, deps.ingestDeps, allowedHosts);
        case "/healthz":
          return Response.json({ status: "ok", uptimeMs: Date.now() - startedAt.getTime() });
        default:
          return new Response("not found", { status: 404 });
      }
    },
  });

  allowedHosts = new Set([`127.0.0.1:${server.port}`, `localhost:${server.port}`]);
  return { server, mcp };
}
