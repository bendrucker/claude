import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildAttribution } from "../../scripts/inbox";
import {
  ATTRIBUTES,
  chunk,
  limitItems,
  registerTools,
  type ThingsClient,
  TruncatedPayload,
  validateCaptureTitles,
  validateNonBlank,
  writeParams,
} from "./tools";

describe("chunk", () => {
  test.each<[string, number[], number, number[][]]>([
    [
      "splits evenly",
      [1, 2, 3, 4],
      2,
      [
        [1, 2],
        [3, 4],
      ],
    ],
    ["keeps remainder", [1, 2, 3], 2, [[1, 2], [3]]],
    ["single chunk when under size", [1, 2], 250, [[1, 2]]],
    ["empty input", [], 2, []],
  ])("%s", (_name, items, size, expected) => {
    expect(chunk(items, size)).toEqual(expected);
  });
});

describe("writeParams", () => {
  test("maps tool args to URL scheme params", () => {
    expect(
      Object.fromEntries(
        writeParams({
          title: "New title",
          append_notes: "more",
          when: "today",
          tags: ["a", "b"],
          add_tags: ["c"],
          checklist_items: ["one", "two"],
          todos: ["first", "second"],
          list_id: "PID",
          completed: true,
          canceled: false,
        }),
      ),
    ).toEqual({
      title: "New title",
      "append-notes": "more",
      when: "today",
      tags: "a,b",
      "add-tags": "c",
      "checklist-items": "one\ntwo",
      "to-dos": "first\nsecond",
      "list-id": "PID",
      completed: "true",
      canceled: "false",
    });
  });

  test("omits undefined fields", () => {
    expect(writeParams({ title: undefined })).toEqual(new Map());
  });

  // A tool hands its whole argument object over, including fields that steer the handler.
  test("ignores arguments that are not attributes", () => {
    const args = { title: "Buy milk", create_tags: true, session_id: "abc" };
    expect(writeParams({ ...args })).toEqual(new Map([["title", "Buy milk"]]));
  });
});

describe("validateCaptureTitles", () => {
  test.each<[string, string | undefined, string[] | undefined]>([
    ["title only", "one", undefined],
    ["titles only", undefined, ["one", "two"]],
  ])("accepts %s", (_name, title, titles) => {
    expect(() => validateCaptureTitles(title, titles)).not.toThrow();
  });

  test.each<[string, string | undefined, string[] | undefined, string]>([
    ["both title and titles", "one", ["two"], "not both"],
    ["title with empty titles", "one", [], "not both"],
    ["neither", undefined, undefined, "title or titles is required"],
    ["empty title only", "", undefined, "title or titles is required"],
    ["empty titles only", undefined, [], "title or titles is required"],
    ["whitespace title only", "  ", undefined, "title or titles is required"],
    ["a blank entry among titles", undefined, ["one", ""], "titles[1] must be a non-empty string"],
  ])("rejects %s", (_name, title, titles, message) => {
    expect(() => validateCaptureTitles(title, titles)).toThrow(message);
  });
});

describe("validateNonBlank", () => {
  test("accepts non-empty values", () => {
    expect(() => validateNonBlank(["abc", "def"], "ids")).not.toThrow();
  });

  test.each<[string, string[], string, string]>([
    ["empty string", ["abc", ""], "ids", 'ids[1] must be a non-empty string, got ""'],
    ["whitespace only", ["  "], "ids", 'ids[0] must be a non-empty string, got "  "'],
    ["names the field", [""], "titles", 'titles[0] must be a non-empty string, got ""'],
  ])("rejects %s", (_name, values, field, message) => {
    expect(() => validateNonBlank(values, field)).toThrow(message);
  });
});

describe("limitItems", () => {
  /** One todo-sized record, padded so a few hundred of them exceed the budget. */
  function todo(index: number) {
    return { id: `id-${index}`, name: `Todo ${index}`, notes: "x".repeat(200) };
  }

  const oversized = Array.from({ length: 400 }, (_, index) => todo(index));

  const guidance = "Pass a limit.";

  test("returns a small array untouched", () => {
    const items = [todo(0), todo(1)];
    expect(limitItems(items, guidance)).toBe(items);
  });

  test("returns a small object payload untouched", () => {
    const payload = { count: 1, items: [todo(0)] };
    expect(limitItems(payload, guidance)).toBe(payload);
  });

  test("passes through a payload with no item list", () => {
    expect(limitItems({ error: "nope" }, guidance)).toEqual({ error: "nope" });
  });

  test("drops items from the end of an oversized array", () => {
    const limited = TruncatedPayload.parse(limitItems(oversized, guidance));

    expect(limited.truncated).toBe(true);
    expect(limited.total).toBe(400);
    expect(limited.returned).toBeLessThan(400);
    expect(limited.items).toEqual(oversized.slice(0, limited.returned));
    expect(limited.note).toBe(
      `${400 - limited.returned} of 400 items omitted to fit the response budget. ${guidance}`,
    );
  });

  test("keeps the other fields of an oversized object payload", () => {
    const limited = TruncatedPayload.extend({ count: z.number() }).parse(
      limitItems({ count: 400, items: oversized }, guidance),
    );

    expect(limited.count).toBe(400);
    expect(limited.truncated).toBe(true);
    expect(limited.total).toBe(400);
  });

  // Serialized size is what decides whether the framed JSON-RPC line fits a
  // proxy's 64KB read buffer.
  test.each<[string, unknown]>([
    ["array", oversized],
    ["object payload", { count: 400, items: oversized }],
  ])("holds %s under the budget", (_name, payload) => {
    expect(JSON.stringify(limitItems(payload, guidance)).length).toBeLessThanOrEqual(32_768);
  });
});

/**
 * Records what a tool call asked of Things and answers as a successful xcall
 * round trip, so a handler runs end to end without launching Things.
 */
function fakeClient() {
  const calls = {
    launches: 0,
    dispatch: [] as { command: string; params: Record<string, string> }[],
    tags: [] as { requested: string[]; createMissing: boolean }[],
    paced: [] as number[],
  };
  const client: ThingsClient = {
    ensureRunning: () => {
      calls.launches += 1;
      return Promise.resolve();
    },
    dispatch: (command, params) => {
      calls.dispatch.push({ command, params: Object.fromEntries(params) });
      return Promise.resolve({
        id: "ABC123",
        output: "things:///x-callback-url/add?x-things-id=ABC123",
        viaXcall: true,
        fallbackReason: null,
        fallbackDetail: null,
      });
    },
    // Stands in for the case folding the real requirer does against Things' own
    // tag list, so a call's expected params show which spelling was sent.
    requireTags: (requested, createMissing) => {
      calls.tags.push({ requested, createMissing });
      return Promise.resolve(requested.map((tag) => tag.toLowerCase()));
    },
    pace: (ms) => {
      calls.paced.push(ms);
      return Promise.resolve();
    },
  };
  return { calls, client };
}

const ToolResult = z.looseObject({
  isError: z.boolean().optional(),
  content: z.array(z.looseObject({ text: z.string() })).optional(),
});

const ToolList = z.looseObject({
  tools: z.array(
    z.looseObject({
      name: z.string(),
      inputSchema: z.looseObject({ properties: z.record(z.string(), z.unknown()).optional() }),
    }),
  ),
});

const WRITE_TOOLS = new Set([
  "add_todo",
  "add_project",
  "update_project",
  "update_todos",
  "capture_inbox",
]);

/** Arguments a write tool reads itself rather than passing to `writeParams`. */
const STEERING_ARGUMENTS = new Set(["id", "ids", "create_tags", "session_id", "directory"]);

/** Connects a client to a server carrying only the fake, over an in-memory pair. */
async function connect(client: ThingsClient): Promise<Client> {
  const server = new McpServer({ name: "things.test", version: "0" });
  registerTools(server, client);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "tools.test", version: "0" });
  await Promise.all([mcp.connect(clientTransport), server.connect(serverTransport)]);
  return mcp;
}

interface WriteCase {
  tool: string;
  arguments: Record<string, unknown>;
  command: string;
  params: Record<string, string>;
  tags: { requested: string[]; createMissing: boolean }[];
}

describe("write tools", () => {
  test.each<[string, WriteCase]>([
    [
      "add_todo",
      {
        tool: "add_todo",
        arguments: {
          title: "Buy milk",
          notes: "whole",
          when: "today",
          deadline: "2026-09-30",
          tags: ["Bug"],
          checklist_items: ["one", "two"],
          list: "Errands",
          list_id: "PID",
          heading: "Groceries",
        },
        command: "add",
        params: {
          title: "Buy milk",
          notes: "whole",
          when: "today",
          deadline: "2026-09-30",
          tags: "bug",
          "checklist-items": "one\ntwo",
          list: "Errands",
          "list-id": "PID",
          heading: "Groceries",
        },
        tags: [{ requested: ["Bug"], createMissing: false }],
      },
    ],
    [
      "add_project",
      {
        tool: "add_project",
        arguments: {
          title: "Move house",
          notes: "before October",
          when: "anytime",
          deadline: "2026-10-31",
          area: "Home",
          area_id: "AID",
          tags: ["Bug"],
          create_tags: true,
          todos: ["pack", "hire movers"],
        },
        command: "add-project",
        params: {
          title: "Move house",
          notes: "before October",
          when: "anytime",
          deadline: "2026-10-31",
          area: "Home",
          "area-id": "AID",
          tags: "bug",
          "to-dos": "pack\nhire movers",
        },
        tags: [{ requested: ["Bug"], createMissing: true }],
      },
    ],
    [
      "update_project",
      {
        tool: "update_project",
        arguments: {
          id: "PID",
          title: "Move house",
          prepend_notes: "top",
          append_notes: "bottom",
          area: "Home",
          area_id: "AID",
          add_tags: ["Bug"],
          completed: true,
        },
        command: "update-project",
        params: {
          id: "PID",
          title: "Move house",
          "prepend-notes": "top",
          "append-notes": "bottom",
          area: "Home",
          "area-id": "AID",
          "add-tags": "bug",
          completed: "true",
        },
        tags: [{ requested: ["Bug"], createMissing: false }],
      },
    ],
    [
      "update_todos",
      {
        tool: "update_todos",
        arguments: {
          ids: ["T1"],
          when: "evening",
          tags: ["Bug"],
          checklist_items: ["one"],
          prepend_checklist_items: ["first"],
          append_checklist_items: ["last"],
          list: "Errands",
          list_id: "PID",
          canceled: false,
        },
        command: "update",
        params: {
          id: "T1",
          when: "evening",
          tags: "bug",
          "checklist-items": "one",
          "prepend-checklist-items": "first",
          "append-checklist-items": "last",
          list: "Errands",
          "list-id": "PID",
          canceled: "false",
        },
        tags: [{ requested: ["Bug"], createMissing: false }],
      },
    ],
    [
      "capture_inbox",
      {
        tool: "capture_inbox",
        arguments: {
          titles: ["Follow up", "Reply"],
          notes: "context",
          tags: ["Bug"],
          checklist_items: ["one"],
        },
        command: "add",
        params: {
          titles: "Follow up\nReply",
          notes: "context",
          tags: "claude,bug",
          "checklist-items": "one",
        },
        tags: [{ requested: ["claude", "Bug"], createMissing: false }],
      },
    ],
  ])("%s builds its params", async (_name, expected) => {
    const { calls, client } = fakeClient();
    const mcp = await connect(client);

    const result = ToolResult.parse(
      await mcp.callTool({ name: expected.tool, arguments: expected.arguments }),
    );

    expect(result.isError).toBeUndefined();
    expect(calls.launches).toBe(1);
    expect(calls.dispatch).toEqual([{ command: expected.command, params: expected.params }]);
    expect(calls.tags).toEqual(expected.tags);
    await mcp.close();
  });

  test("appends session attribution to a capture's notes", async () => {
    const { calls, client } = fakeClient();
    const mcp = await connect(client);

    await mcp.callTool({
      name: "capture_inbox",
      arguments: { title: "Follow up", notes: "context", session_id: "S1", directory: "/tmp/repo" },
    });

    expect(calls.dispatch[0]?.params.notes).toBe(
      `context\n\n${buildAttribution("S1", "/tmp/repo")}`,
    );
    await mcp.close();
  });

  test("paces update_todos past the batch size", async () => {
    const { calls, client } = fakeClient();
    const mcp = await connect(client);
    const ids = Array.from({ length: 251 }, (_, index) => `T${index}`);

    await mcp.callTool({ name: "update_todos", arguments: { ids, when: "today" } });

    expect(calls.dispatch.map((call) => call.command)).toEqual(["json", "json"]);
    expect(calls.paced).toEqual([10_000]);
    expect(
      z.array(z.unknown()).parse(JSON.parse(calls.dispatch[0]?.params.data ?? "")),
    ).toHaveLength(250);
    await mcp.close();
  });

  test("routes reorder_todos through the client", async () => {
    const { calls, client } = fakeClient();
    const mcp = await connect(client);

    await mcp.callTool({ name: "reorder_todos", arguments: { ids: ["T1", "T2"], list: "today" } });

    expect(calls.dispatch.map((call) => call.command)).toEqual(["json", "json"]);
    await mcp.close();
  });

  test("rejects an update naming no attribute", async () => {
    const { calls, client } = fakeClient();
    const mcp = await connect(client);

    const result = ToolResult.parse(
      await mcp.callTool({ name: "update_todos", arguments: { ids: ["T1"] } }),
    );

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("At least one attribute to update is required");
    expect(calls.launches).toBe(0);
    await mcp.close();
  });

  test("every advertised write argument names an attribute", async () => {
    const { client } = fakeClient();
    const mcp = await connect(client);

    const { tools } = ToolList.parse(await mcp.listTools());
    const unmapped = tools
      .filter((tool) => WRITE_TOOLS.has(tool.name))
      .flatMap((tool) =>
        Object.keys(tool.inputSchema.properties ?? {})
          .filter((name) => !(name in ATTRIBUTES) && !STEERING_ARGUMENTS.has(name))
          .map((name) => `${tool.name}.${name}`),
      );

    expect(unmapped).toEqual([]);
    await mcp.close();
  });
});
