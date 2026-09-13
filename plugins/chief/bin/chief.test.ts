import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ensureDaemon } from "./chief";

const BIN_PATH = join(import.meta.dirname, "chief.ts");
const STATE_ROOT = join(import.meta.dirname, "__fixtures__");

let stateDir: string | undefined;

afterEach(async () => {
  if (stateDir === undefined) return;
  const pidText = await Bun.file(join(stateDir, "daemon.pid"))
    .text()
    .catch(() => "");
  const pid = Number(pidText.trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  await rm(stateDir, { recursive: true, force: true });
  stateDir = undefined;
});

test("ensureDaemon spawns only when unhealthy, then waits for healthy", async () => {
  const unitStateDir = join(STATE_ROOT, "ensure-daemon-unhealthy");
  process.env.CHIEF_STATE_DIR = unitStateDir;
  try {
    let checks = 0;
    const healthy = () => Promise.resolve(checks++ > 0);
    let spawns = 0;
    const spawn = () => {
      spawns += 1;
      return 4242;
    };

    await ensureDaemon({ healthy, spawn });
    expect(spawns).toBe(1);
  } finally {
    delete process.env.CHIEF_STATE_DIR;
    await rm(unitStateDir, { recursive: true, force: true });
  }
});

test("ensureDaemon does not spawn when already healthy", async () => {
  let spawns = 0;
  await ensureDaemon({
    healthy: () => Promise.resolve(true),
    spawn: () => {
      spawns += 1;
      return 1;
    },
  });
  expect(spawns).toBe(0);
});

async function findFreePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  await probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve did not assign a port");
  return port;
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop -- polling must happen serially
    await Bun.sleep(50);
  }
  throw new Error(`pid ${pid} did not exit in time`);
}

test("chief mcp starts the daemon, bridges tools, and respawns after the daemon dies", async () => {
  const port = await findFreePort();
  const actPort = await findFreePort();
  stateDir = join(STATE_ROOT, `daemon-lifecycle-${port}`);

  const transport = new StdioClientTransport({
    command: "bun",
    args: [BIN_PATH, "mcp"],
    env: {
      ...process.env,
      CHIEF_STATE_DIR: stateDir,
      CHIEF_PORT: String(port),
      CHIEF_ACT_PORT: String(actPort),
    },
  });
  const client = new Client({ name: "chief-lifecycle-test", version: "0.0.0" });
  await client.connect(transport);

  const first = await client.listTools();
  expect(first.tools.map((tool) => tool.name).toSorted()).toEqual([
    "ack",
    "append",
    "drop",
    "hold",
    "inbox",
    "status",
    "why",
  ]);

  const firstPid = Number((await Bun.file(join(stateDir, "daemon.pid")).text()).trim());
  process.kill(firstPid, "SIGKILL");
  await waitForExit(firstPid);

  const second = await client.listTools();
  expect(second.tools.map((tool) => tool.name).toSorted()).toEqual(
    first.tools.map((tool) => tool.name).toSorted(),
  );

  const secondPid = Number((await Bun.file(join(stateDir, "daemon.pid")).text()).trim());
  expect(secondPid).not.toBe(firstPid);

  await client.close();
}, 20_000);
