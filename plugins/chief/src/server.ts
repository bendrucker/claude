import { z } from "zod";
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
import { publish, type NtfyConfig } from "./ntfy";
import { subscribe, type Reply } from "./replies";
import { due } from "./release";
import { start as startTimers, type Schedule, type TimersHandle } from "./timers";
import type { Store } from "./store";

const PORT = 7391;

function hasAllowedHost(req: Request, allowedHosts: Set<string>): boolean {
  return allowedHosts.has(req.headers.get("host") ?? "");
}

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
  ntfy?: NtfyConfig;
  createStore: (getLastDoorbell: () => "ok" | "stalled" | null) => Store;
  now?: () => Date;
  schedule?: Schedule;
  startedAt?: Date;
  ring?: (agent: string, text?: string) => Promise<RingResult>;
}

export interface ChiefDaemon extends ChiefServer {
  timers: TimersHandle;
  unsubscribe: () => void;
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

  async function releaseCheck(): Promise<void> {
    const rows = [...(await readLedger(deps.ledgerPath)).values()];
    for (const row of due(rows, now())) {
      // oxlint-disable-next-line no-await-in-loop -- ledger transitions must serialize
      const pushed = await transitionLedger(row.id, { state: "pushed" }, deps.ledgerPath, now());
      if (deps.ntfy) {
        // oxlint-disable-next-line no-await-in-loop -- one publish per row, in ledger order
        await publish(pushed, deps.ntfy).catch((error: unknown) =>
          console.error("ntfy publish", error),
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- doorbell rings must serialize
      const result = await ringDoorbell(deps.herdrAgent);
      lastDoorbell = result.status;
    }
  }

  async function flockTick(): Promise<void> {
    const result = await ringDoorbell(deps.herdrAgent, "/flock tick");
    lastDoorbell = result.status;
  }

  const startedAt = deps.startedAt ?? now();
  const server = startServer({ store, ingestDeps: deps.ingestDeps, startedAt }, options);

  const scheduleOption = deps.schedule !== undefined ? { schedule: deps.schedule } : {};
  const timers = startTimers({
    releaseCheck,
    flockTick,
    workHours: deps.workHours,
    now,
    ...scheduleOption,
  });

  const HOLD_FOR = ["1h", "3h", "1d"] as const;
  async function applyReply(reply: Reply): Promise<void> {
    if (reply.op === "drop") {
      await transitionLedger(reply.id, { state: "dropped" }, deps.ledgerPath, now());
      return;
    }
    if (reply.op !== "hold") return;
    const holdFor = HOLD_FOR.find((value) => value === reply.for);
    await store.hold(
      holdFor !== undefined ? { id: reply.id, for: holdFor } : { id: reply.id, until: reply.until },
    );
  }
  const unsubscribe = deps.ntfy
    ? subscribe(
        deps.ntfy,
        (reply) =>
          void applyReply(reply).catch((error: unknown) => console.error("ntfy reply", error)),
      )
    : () => {};

  return { ...server, timers, unsubscribe };
}
