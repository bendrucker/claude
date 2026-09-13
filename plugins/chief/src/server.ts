import { z } from "zod";
import { startActServer } from "./act";
import { read as readLedger, transition as transitionLedger } from "./ledger";
import { ring, type RingResult } from "./doorbell";
import {
  drainSpool,
  HookPayloadSchema,
  ingest,
  type HerdrAgentList,
  type HookPayload,
  type IngestDeps,
} from "./ingest";
import { createMcpServers, type McpServers } from "./mcp";
import { publish, type BarkConfig } from "./bark";
import { due } from "./release";
import { start as startTimers, type Schedule, type TimersDeps, type TimersHandle } from "./timers";
import type { Store } from "./store";

const PORT = 7391;

function hasAllowedHost(req: Request, allowedHosts: Set<string>): boolean {
  return allowedHosts.has(req.headers.get("host") ?? "");
}

const HerdrAgentsSchema = z.object({
  agents: z.array(
    z.object({
      pane_id: z.string(),
      name: z.string().optional(),
      agent_session: z.object({ value: z.string() }).nullable(),
    }),
  ),
});
// The CLI wraps its result in a { id, result } envelope.
export const HerdrAgentListSchema = z.union([
  z.object({ result: HerdrAgentsSchema }),
  HerdrAgentsSchema,
]);

export async function herdrListAgents(): Promise<HerdrAgentList> {
  const proc = Bun.spawn(["herdr", "agent", "list"], { stdout: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const parsed = HerdrAgentListSchema.parse(JSON.parse(output));
  const { agents } = "result" in parsed ? parsed.result : parsed;
  return {
    agents: agents.flatMap((agent) =>
      agent.agent_session === null
        ? []
        : [{ pane: agent.pane_id, name: agent.name, agent_session: agent.agent_session }],
    ),
  };
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

  const parsed = HookPayloadSchema.safeParse(body);
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
  actPort?: number;
}

export interface ChiefServer {
  server: ReturnType<typeof Bun.serve>;
  mcp: McpServers;
}

export function startServer(deps: ChiefServerDeps, options: ChiefServerOptions = {}): ChiefServer {
  const mcp = createMcpServers(deps.store);
  const startedAt = deps.startedAt ?? new Date();
  const port = options.port ?? PORT;
  let allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  const server = Bun.serve({
    development: false,
    port,
    hostname: options.hostname ?? "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      switch (url.pathname) {
        case "/mcp":
          return mcp.full.handleRequest(req);
        case "/node/mcp":
          return mcp.node.handleRequest(req);
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

export interface DaemonDeps {
  ingestDeps: IngestDeps;
  ledgerPath: string;
  spoolPath: string;
  herdrAgent: string;
  workHours: [string, string];
  bark?: BarkConfig;
  actSecret: string;
  createStore: (getLastDoorbell: () => "ok" | "stalled" | null) => Store;
  now?: () => Date;
  schedule?: Schedule;
  flockIntervalMs?: number;
  startedAt?: Date;
  ring?: (agent: string, text?: string) => Promise<RingResult>;
}

export interface ChiefDaemon extends ChiefServer {
  timers: TimersHandle;
  act: ReturnType<typeof Bun.serve>;
}

// chief serve drains the hook-tap spool once at start, then relies on timers.ts to poll the
// ledger for rows past their releaseAt (pushing them and ringing the doorbell) and to nudge
// /flock during work hours.
export async function startDaemon(
  deps: DaemonDeps,
  options: ChiefServerOptions = {},
): Promise<ChiefDaemon> {
  const now = deps.now ?? (() => new Date());
  const ringDoorbell = deps.ring ?? ring;
  let lastDoorbell: RingResult["status"] | null = null;

  const store = deps.createStore(() => lastDoorbell);
  await drainSpool(deps.spoolPath, deps.ingestDeps);

  let releasing = false;
  async function releaseCheck(): Promise<void> {
    // The doorbell's retry ladder can outlast the interval; a second pass would push the same rows again.
    if (releasing) return;
    releasing = true;
    try {
      await releaseDue();
    } catch (error) {
      lastDoorbell = "stalled";
      console.error("release check failed", error);
    } finally {
      releasing = false;
    }
  }

  async function releaseDue(): Promise<void> {
    const rows = [...(await readLedger(deps.ledgerPath)).values()];
    for (const row of due(rows, now())) {
      // oxlint-disable-next-line no-await-in-loop -- ledger transitions must serialize
      const pushed = await transitionLedger(
        row.id,
        { state: "pushed", actor: "daemon" },
        deps.ledgerPath,
        now(),
      );
      if (deps.bark) {
        // oxlint-disable-next-line no-await-in-loop -- one publish per row, in ledger order
        await publish(pushed, deps.bark, deps.actSecret);
      }
      // oxlint-disable-next-line no-await-in-loop -- doorbell rings must serialize
      const result = await ringDoorbell(deps.herdrAgent);
      lastDoorbell = result.status;
    }
  }

  async function flockTick(): Promise<void> {
    try {
      const result = await ringDoorbell(deps.herdrAgent, "/flock tick");
      lastDoorbell = result.status;
    } catch (error) {
      lastDoorbell = "stalled";
      console.error("flock tick failed", error);
    }
  }

  const startedAt = deps.startedAt ?? now();
  const server = startServer({ store, ingestDeps: deps.ingestDeps, startedAt }, options);
  const act = startActServer({ store, port: options.actPort, secret: deps.actSecret });

  const timerDeps: TimersDeps = { releaseCheck, flockTick, workHours: deps.workHours, now };
  if (deps.schedule !== undefined) timerDeps.schedule = deps.schedule;
  if (deps.flockIntervalMs !== undefined) timerDeps.flockIntervalMs = deps.flockIntervalMs;
  const timers = startTimers(timerDeps);

  return { ...server, timers, act };
}
