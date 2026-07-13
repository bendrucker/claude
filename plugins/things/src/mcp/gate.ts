#!/usr/bin/env bun

/**
 * MCP gate: an OAuth-protecting reverse proxy for plain HTTP MCP servers.
 *
 * The gate is the only funnel-facing process. It serves the RFC 9728
 * protected-resource metadata, validates bearer tokens against the
 * authorization server's RFC 7662 introspection endpoint (including the RFC
 * 8707 audience), and enforces first-use approval: an authenticated user who
 * has never connected before is recorded as pending and denied until approved
 * with `gate.ts approve <user>`. Approved requests proxy to the upstream MCP
 * server, which runs loopback-only with no auth code of its own.
 */

import { cli, command } from "cleye";
import {
  bearerToken,
  createVerifier,
  discoverIntrospectionEndpoint,
  protectedResourceMetadata,
  type Verifier,
  wwwAuthenticate,
} from "./auth";
import { createGrantStore, type GrantStore } from "./grants";

const DEFAULT_STATE_DIR = `${process.env.HOME}/.local/state/mcp-gate`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
};

/** Request headers worth forwarding to the upstream MCP server. */
const FORWARD_HEADERS = [
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

interface GateConfig {
  upstream: string;
  resource: string;
  authServer: string;
  verifier: Verifier;
  grants: GrantStore;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...headers },
  });
}

async function handle(req: Request, config: GateConfig): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const mcpPath = new URL(config.resource).pathname;

  if (url.pathname === "/healthz") {
    return json({ ok: true });
  }

  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    return json(protectedResourceMetadata(config.authServer, config.resource));
  }

  if (url.pathname !== mcpPath) {
    return new Response(null, { status: 404, headers: CORS_HEADERS });
  }

  const token = bearerToken(req.headers.get("authorization") ?? undefined);
  const info = token ? await config.verifier(token) : null;
  if (!info) {
    return new Response(null, {
      status: 401,
      headers: { ...CORS_HEADERS, "WWW-Authenticate": wwwAuthenticate(config.resource) },
    });
  }

  const user = typeof info.username === "string" ? info.username : null;
  if (!user) {
    return json({ error: "access_denied", error_description: "token has no user identity" }, 403);
  }

  const grant = (await config.grants.get(user)) ?? (await config.grants.recordPending(user));
  if (grant.status !== "approved") {
    console.error(
      `denied ${grant.status} user ${user}. Approve with: bun ${import.meta.path} approve ${user}`,
    );
    return json(
      { error: "access_denied", error_description: `user ${user} is ${grant.status} approval` },
      403,
    );
  }

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-Gate-User", user);

  const upstream = await fetch(config.upstream, {
    method: req.method,
    headers,
    body: req.body ? await req.arrayBuffer() : undefined,
  });

  const responseHeaders = new Headers(CORS_HEADERS);
  for (const name of ["content-type", "mcp-session-id"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

async function serve(flags: {
  port: number;
  upstream: string;
  authorizationServer: string;
  resource: string;
  stateDir: string;
}): Promise<void> {
  const { port, upstream, authorizationServer, resource, stateDir } = flags;

  const config: GateConfig = {
    upstream,
    resource,
    authServer: authorizationServer,
    verifier: createVerifier(await discoverIntrospectionEndpoint(authorizationServer), {
      resource,
    }),
    grants: createGrantStore(`${stateDir}/grants.json`),
  };

  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: (req) =>
      handle(req, config).catch((error) => {
        console.error(error);
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }),
  });

  console.error(`mcp-gate listening on http://127.0.0.1:${port}`);
  console.error(`upstream: ${upstream}`);
  console.error(`resource: ${resource}, authorization server: ${authorizationServer}`);
  console.error(`grants: ${stateDir}/grants.json`);
}

if (import.meta.main) {
  const stateDirFlag = {
    type: String,
    default: DEFAULT_STATE_DIR,
    description: "Directory holding grants.json",
  } as const;

  const serveCmd = command(
    {
      name: "serve",
      flags: {
        port: {
          type: Number,
          default: 3111,
          description: "Port to listen on (loopback only, published by funnel)",
        },
        upstream: {
          type: String,
          description: "URL of the plain MCP server to proxy (e.g. http://127.0.0.1:3112/mcp)",
        },
        authorizationServer: {
          type: String,
          description: "OAuth authorization server base URL",
        },
        resource: {
          type: String,
          description: "Public URL of the MCP endpoint. Its path becomes the local mount path.",
        },
        stateDir: stateDirFlag,
      },
    },
    async (parsed) => {
      const { upstream, authorizationServer, resource } = parsed.flags;
      if (!upstream || !authorizationServer || !resource) {
        console.error("--upstream, --authorization-server, and --resource are required");
        process.exit(1);
      }
      await serve({ ...parsed.flags, upstream, authorizationServer, resource });
    },
  );

  const approveCmd = command(
    { name: "approve", parameters: ["<user>"], flags: { stateDir: stateDirFlag } },
    async (parsed) => {
      const grant = await createGrantStore(`${parsed.flags.stateDir}/grants.json`).set(
        parsed._.user,
        "approved",
      );
      console.log(`approved ${grant.user}`);
    },
  );

  const denyCmd = command(
    { name: "deny", parameters: ["<user>"], flags: { stateDir: stateDirFlag } },
    async (parsed) => {
      const grant = await createGrantStore(`${parsed.flags.stateDir}/grants.json`).set(
        parsed._.user,
        "denied",
      );
      console.log(`denied ${grant.user}`);
    },
  );

  const listCmd = command({ name: "list", flags: { stateDir: stateDirFlag } }, async (parsed) => {
    const grants = await createGrantStore(`${parsed.flags.stateDir}/grants.json`).list();
    if (grants.length === 0) {
      console.log("no grants");
      return;
    }
    for (const grant of grants) {
      console.log(`${grant.status}\t${grant.user}\t(first seen ${grant.firstSeen})`);
    }
  });

  cli(
    {
      name: "mcp-gate",
      help: {
        description: "OAuth gate and first-use approval proxy for HTTP MCP servers.",
      },
      commands: [serveCmd, approveCmd, denyCmd, listCmd],
    },
    (parsed) => {
      parsed.showHelp();
    },
  );
}
