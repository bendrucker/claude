import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "stdio.ts");

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
];

/**
 * Drives the server the way tailgate does: JSON-RPC in on stdin, responses out
 * on stdout. Neither initialize nor tools/list touches Things, so this runs on
 * any platform.
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
    expect(lines).toHaveLength(2);
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
});
