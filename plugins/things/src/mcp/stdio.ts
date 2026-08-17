#!/usr/bin/env bun
// claude:dangerouslyDisableSandbox: reaches osascript and the Things URL scheme through the read and write tools, which the command sandbox blocks

/**
 * Things MCP server over stdio.
 *
 * stdout is the JSON-RPC channel and carries nothing else. Diagnostics go to
 * stderr, which tailgate captures into its logs.
 *
 * No auth, no port, no listening socket. tailgate spawns this as a child
 * process and owns OAuth, token introspection, audience validation, and
 * per-identity policy. See README.md.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools";

if (import.meta.main) {
  const server = new McpServer({ name: "things", version: "0.1.0" });
  registerTools(server);
  await server.connect(new StdioServerTransport());
}
