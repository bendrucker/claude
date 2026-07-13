#!/usr/bin/env bun

/**
 * Things MCP server: Streamable HTTP transport, OAuth-protected via tsidp.
 *
 * Runs stateless (a fresh McpServer per POST), binds loopback only, and is
 * published to the tailnet/internet by Tailscale Serve/Funnel in front of it.
 * See README.md for the launchd + Tailscale setup.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { cli } from "cleye";
import {
  bearerToken,
  createVerifier,
  discoverIntrospectionEndpoint,
  protectedResourceMetadata,
  type Verifier,
  wwwAuthenticate,
} from "./auth";
import { registerTools } from "./tools";

const SERVER_INFO = { name: "things", version: "0.1.0" };

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
}

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
        default: 3111,
        description: "Port to listen on (loopback only)",
      },
      authorizationServer: {
        type: String,
        description: "OAuth authorization server base URL (e.g. https://idp.<tailnet>.ts.net)",
      },
      resource: {
        type: String,
        description:
          "Public URL of the MCP endpoint (e.g. https://<host>.<tailnet>.ts.net/mcp). Its path also becomes the local endpoint path, so multiple servers can share a host under different mounts.",
      },
      insecureNoAuth: {
        type: Boolean,
        default: false,
        description: "Disable OAuth entirely. Local testing only.",
      },
    },
  });

  const { port, authorizationServer, resource, insecureNoAuth } = argv.flags;

  let verifier: Verifier | null = null;
  let resourceUrl = resource ?? `http://localhost:${port}/mcp`;
  let authServerUrl = authorizationServer ?? "";

  if (insecureNoAuth) {
    console.error("WARNING: --insecure-no-auth is set. Every request is accepted.");
  } else {
    if (!authorizationServer || !resource) {
      console.error(
        "--authorization-server and --resource are required (or pass --insecure-no-auth for local dev)",
      );
      process.exit(1);
    }
    authServerUrl = authorizationServer;
    resourceUrl = resource;
    verifier = createVerifier(await discoverIntrospectionEndpoint(authorizationServer));
  }

  const mcpPath = new URL(resourceUrl).pathname;

  const httpServer = createServer(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        sendJson(res, 200, protectedResourceMetadata(authServerUrl, resourceUrl));
        return;
      }

      if (url.pathname === mcpPath) {
        if (verifier) {
          const token = bearerToken(req.headers.authorization);
          const info = token ? await verifier(token) : null;
          if (!info) {
            res.writeHead(401, { "WWW-Authenticate": wwwAuthenticate(resourceUrl) });
            res.end();
            return;
          }
        }
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
    console.error(`things-mcp listening on http://127.0.0.1:${port}${mcpPath}`);
    console.error(`resource URL: ${resourceUrl}`);
    console.error(
      insecureNoAuth ? "auth: DISABLED" : `auth: authorization server at ${authServerUrl}`,
    );
  });
}
