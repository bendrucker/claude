import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "stdio.ts");

/**
 * Every call here has to be rejected by a tool's schema, which the server
 * applies before it dispatches to a handler. A handler is where Things gets
 * launched and written to, so an argument that reached one would exercise a
 * write against real task data.
 */
const REJECTED_CALLS = [
  {
    name: "query_logbook",
    arguments: { start: "not-a-date", end: "also-bad" },
  },
  {
    name: "reorder_todos",
    arguments: { ids: ["  "], list: "today" },
  },
  {
    name: "capture_inbox",
    arguments: { title: "Follow up", session_id: "" },
  },
];

const HANDSHAKE = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stdio.test", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ...REJECTED_CALLS.map((params, index) => ({
    jsonrpc: "2.0",
    id: 3 + index,
    method: "tools/call",
    params,
  })),
];

/**
 * Drives the server the way tailgate does: JSON-RPC in on stdin, responses out
 * on stdout. Nothing here reaches a tool handler, so this runs on any platform
 * and never touches Things.
 */
async function handshake(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Every message needs its own terminating newline. The transport frames on
  // newlines, so a final line without one sits in its buffer until stdin closes
  // and is then discarded unanswered.
  const requests = HANDSHAKE.map((message) => `${JSON.stringify(message)}\n`).join("");
  const proc = Bun.spawn([process.execPath, SERVER], {
    stdin: new TextEncoder().encode(requests),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

const result = await handshake();
const lines = result.stdout.split("\n").filter(Boolean);

describe("stdio server", () => {
  test("exits cleanly when stdin closes", () => {
    expect(result.exitCode).toBe(0);
  });

  // A stray write to stdout anywhere in the import closure arrives here as an
  // unparseable line, and in production it desynchronizes the client's JSON-RPC
  // framing. Every diagnostic in the closure has to reach stderr instead.
  test("writes nothing but JSON-RPC to stdout", () => {
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(lines).toHaveLength(HANDSHAKE.length - 1);
  });

  test("keeps startup stderr quiet", () => {
    expect(result.stderr).toBe("");
  });

  test("advertises the full tool set", () => {
    const listed = JSON.parse(lines[1] ?? "null") as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listed.result.tools.map((tool) => tool.name)).toMatchInlineSnapshot(`
      [
        "list_todos",
        "find_todos",
        "query_logbook",
        "list_metadata",
        "add_todo",
        "add_project",
        "update_todos",
        "capture_inbox",
        "reorder_todos",
      ]
    `);
  });

  // Each of these arguments would otherwise reach Things: an unparseable date
  // makes query-logbook.js scan the whole logbook, a blank id is accepted
  // silently, and a blank session id drops the attribution it was passed for.
  // The snapshot carries the field each rejection names, so a guard that stops
  // covering its field fails here rather than passing on some other error.
  test("rejects arguments that would reach Things", () => {
    const rejections = REJECTED_CALLS.map((_call, index) => {
      const response = JSON.parse(lines[2 + index] ?? "null") as {
        result: { isError: boolean; content: Array<{ text: string }> };
      };
      expect(response.result.isError).toBe(true);
      return response.result.content[0]?.text;
    });
    expect(rejections).toMatchInlineSnapshot(`
      [
        
      "MCP error -32602: Input validation error: Invalid arguments for tool query_logbook: must be an ISO 8601 date at start
      must be an ISO 8601 date at end"
      ,
        "MCP error -32602: Input validation error: Invalid arguments for tool reorder_todos: Too small: expected string to have >=1 characters at ids[0]",
        "MCP error -32602: Input validation error: Invalid arguments for tool capture_inbox: Too small: expected string to have >=1 characters at session_id",
      ]
    `);
  });
});
