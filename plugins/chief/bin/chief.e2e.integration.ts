import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { startServer, type ChiefServer } from "../src/server";
import { createStubStore } from "../src/store";

const LEDGER_PATH = join(import.meta.dirname, "__fixtures__", "chief.e2e.integration.jsonl");
const MCP_CONFIG_PATH = join(
  import.meta.dirname,
  "__fixtures__",
  "chief.e2e.integration.mcp-config.json",
);

const claudeAvailable = Bun.which("claude") !== null;

afterEach(async () => {
  await rm(LEDGER_PATH, { force: true });
  await rm(MCP_CONFIG_PATH, { force: true });
});

test.skipIf(!claudeAvailable)(
  "claude -p can call the status tool over /mcp",
  async () => {
    let chief: ChiefServer | undefined;
    try {
      chief = startServer(
        {
          store: createStubStore(),
          ingestDeps: {
            ledgerPath: LEDGER_PATH,
            listAgents: () => Promise.resolve({ agents: [] }),
          },
        },
        { port: 0 },
      );
      const baseUrl = `http://127.0.0.1:${chief.server.port}`;
      await Bun.write(
        MCP_CONFIG_PATH,
        JSON.stringify({ mcpServers: { chief: { type: "http", url: `${baseUrl}/mcp` } } }),
      );

      const proc = Bun.spawn(
        [
          "claude",
          "-p",
          "call the chief MCP server's status tool and print its raw JSON result",
          "--model",
          "haiku",
          "--strict-mcp-config",
          "--mcp-config",
          MCP_CONFIG_PATH,
          "--dangerously-skip-permissions",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const output = await new Response(proc.stdout).text();
      await proc.exited;

      expect(output).toContain("daemonUptimeMs");
    } finally {
      await chief?.server.stop(true);
    }
  },
  120_000,
);
