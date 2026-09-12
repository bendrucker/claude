#!/usr/bin/env bun
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { cli, command } from "cleye";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_PATH, checkConfig, formatCheck, runDoctor } from "../src/doctor";
import { ring } from "../src/doorbell";
import { append } from "../src/ledger";
import { startServer } from "../src/server";
import { createStubStore } from "../src/store";
import type { LedgerRow } from "../src/types";

const HEALTHZ_TIMEOUT_MS = 1000;
const HEALTHY_POLL_ATTEMPTS = 30;
const HEALTHY_POLL_INTERVAL_MS = 100;

function stateDir(): string {
  return process.env.CHIEF_STATE_DIR ?? join(homedir(), ".local", "state", "chief");
}

function pidFile(): string {
  return join(stateDir(), "daemon.pid");
}

function logFile(): string {
  return join(stateDir(), "daemon.log");
}

function port(): number {
  return process.env.CHIEF_PORT !== undefined ? Number(process.env.CHIEF_PORT) : 7391;
}

function baseUrl(): string {
  return `http://127.0.0.1:${port()}`;
}

async function probeHealthz(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(HEALTHZ_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilHealthy(healthy: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < HEALTHY_POLL_ATTEMPTS; attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    if (await healthy()) return;
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    await Bun.sleep(HEALTHY_POLL_INTERVAL_MS);
  }
  throw new Error(`daemon at ${baseUrl()} did not become healthy in time`);
}

function spawnDaemon(): number {
  const log = logFile();
  mkdirSync(dirname(log), { recursive: true });
  const proc = Bun.spawn(["bun", import.meta.path, "serve"], {
    cwd: import.meta.dirname,
    env: { ...process.env },
    stdin: "ignore",
    stdout: Bun.file(log),
    stderr: Bun.file(log),
  });
  proc.unref();
  return proc.pid;
}

export interface EnsureDaemonDeps {
  healthy?: () => Promise<boolean>;
  spawn?: () => number;
}

export async function ensureDaemon(deps: EnsureDaemonDeps = {}): Promise<void> {
  const healthy = deps.healthy ?? (() => probeHealthz(baseUrl()));
  if (await healthy()) return;

  const pidFilePath = pidFile();
  mkdirSync(dirname(pidFilePath), { recursive: true });
  const spawn = deps.spawn ?? spawnDaemon;
  const pid = spawn();
  await Bun.write(pidFilePath, String(pid));
  await waitUntilHealthy(healthy);
}

async function connectHttpClient(url: string): Promise<Client> {
  const client = new Client({ name: "chief-bridge", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- StreamableHTTPClientTransport's sessionId getter returns string | undefined, which the SDK's own Transport interface (sessionId?: string) rejects under exactOptionalPropertyTypes.
  await client.connect(transport as Transport);
  return client;
}

async function withEnsureRetry<T>(
  call: (client: Client) => Promise<T>,
  getClient: () => Client,
  reconnect: () => Promise<Client>,
  ensure: () => Promise<void>,
): Promise<T> {
  try {
    return await call(getClient());
  } catch {
    await ensure();
    const client = await reconnect();
    return call(client);
  }
}

export interface BridgeDeps {
  ensure?: (deps?: EnsureDaemonDeps) => Promise<void>;
  baseUrl?: string;
  connectClient?: (baseUrl: string) => Promise<Client>;
  transport?: StdioServerTransport;
}

export async function bridge(deps: BridgeDeps = {}): Promise<void> {
  const ensure = deps.ensure ?? ensureDaemon;
  const url = deps.baseUrl ?? baseUrl();
  const connect = deps.connectClient ?? connectHttpClient;

  await ensure();
  let client = await connect(url);

  // oxlint-disable-next-line typescript/no-deprecated -- proxying raw tools/list and tools/call needs the low-level Server. McpServer requires concrete tool registrations.
  const server = new Server(
    { name: "chief-bridge", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () =>
    withEnsureRetry(
      (c) => c.listTools(),
      () => client,
      async () => {
        client = await connect(url);
        return client;
      },
      ensure,
    ),
  );

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    withEnsureRetry(
      (c) => c.callTool(request.params),
      () => client,
      async () => {
        client = await connect(url);
        return client;
      },
      ensure,
    ),
  );

  await server.connect(deps.transport ?? new StdioServerTransport());
}

function sampleNowRow(now: Date = new Date()): LedgerRow {
  const key = `bell:${now.getTime()}`;
  return {
    id: `manual:${key}`,
    key,
    ts: now.toISOString(),
    source: "manual",
    kind: "dispatch",
    title: "chief bell --test sample row",
    tier: "now",
    releaseAt: now.toISOString(),
    state: "open",
    reason: "chief bell --test",
  };
}

const serveCmd = command({ name: "serve" }, async () => {
  await startServer(
    { store: createStubStore(), ingestDeps: { listAgents: () => Promise.resolve({ agents: [] }) } },
    { port: port() },
  );
  console.log(`chief serving on ${baseUrl()}`);
});

const mcpCmd = command({ name: "mcp" }, async () => {
  await bridge();
});

const doctorCmd = command({ name: "doctor" }, async () => {
  const checks = await runDoctor({ baseUrl: baseUrl() });
  for (const check of checks) console.log(formatCheck(check));
  process.exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
});

const bellCmd = command(
  {
    name: "bell",
    flags: {
      test: {
        type: Boolean,
        description: "Append a sample now row instead of ringing the doorbell",
      },
    },
  },
  async (argv) => {
    if (argv.flags.test) {
      const row = sampleNowRow();
      append(row, join(stateDir(), "ledger.jsonl"));
      console.log(JSON.stringify(row));
      return;
    }

    const { config } = await checkConfig(CONFIG_PATH);
    if (!config) {
      console.error(`chief bell: could not read config at ${CONFIG_PATH}`);
      process.exitCode = 1;
      return;
    }

    const result = await ring(config.herdr.agent);
    console.log(JSON.stringify(result));
  },
);

if (import.meta.main) {
  void cli({ name: "chief", commands: [serveCmd, mcpCmd, doctorCmd, bellCmd] }, (parsed) => {
    parsed.showHelp();
  });
}
