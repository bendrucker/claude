#!/usr/bin/env bun

/**
 * Things MCP server: stateless Streamable HTTP transport, loopback only.
 *
 * This process has no auth code. It binds 127.0.0.1 and is only reachable
 * through the gate (gate.ts), which owns OAuth, first-use approval, and the
 * funnel-facing port. See README.md for the launchd + Tailscale setup.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { cli } from "cleye";
import { registerTools } from "./tools";

const SERVER_INFO = { name: "things", version: "0.1.0" };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end();
    return;
  }

  const body = await readBody(req);
  const server = new McpServer(SERVER_INFO);
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

if (import.meta.main) {
  const argv = cli({
    name: "things-mcp",
    flags: {
      port: {
        type: Number,
        default: 3112,
        description: "Port to listen on (loopback only)",
      },
      path: {
        type: String,
        default: "/mcp",
        description: "URL path of the MCP endpoint",
      },
    },
  });

  const { port, path } = argv.flags;

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname === path) {
        await handleMcp(req, res);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        res.end();
      }
    }
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`things-mcp listening on http://127.0.0.1:${port}${path}`);
  });
}
