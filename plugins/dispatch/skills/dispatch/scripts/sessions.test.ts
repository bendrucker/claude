import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  applyOrder,
  currentSession,
  HostUnreachableError,
  type LiveSession,
  sortSessions,
  listLiveSessions,
  loadDescriptions,
  parseDescriptions,
  recentAreas,
  renderSessions,
  type RexRunner,
} from "./sessions";
import { type DispatchLedgerRow, parseLedgerLine, type LedgerRow } from "./ledger";

const NOW = new Date("2026-11-24T00:00:00Z");

function row(ts: string, rexSession?: string): LedgerRow {
  const result: DispatchLedgerRow = {
    ts,
    task: "t",
    repo: "/r",
    branch: "b",
    path: null,
    mux: "rex",
    target: null,
    host: null,
    name: "n",
    session: null,
    sender: null,
    outcome: "dispatched",
  };
  if (rexSession != null) result.rexSession = rexSession;
  return result;
}

test("a missing sessions file yields no descriptions and no warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sessions-"));
  const result = await loadDescriptions(join(dir, "sessions.toml"));
  expect(result.descriptions.size).toBe(0);
  expect(result.warning).toBeUndefined();
});

test("a malformed sessions file warns and yields no descriptions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sessions-"));
  const file = join(dir, "sessions.toml");
  await Bun.write(file, "[[session]\nname = ");
  const result = await loadDescriptions(file);
  expect(result.descriptions.size).toBe(0);
  expect(result.warning).toContain("malformed");
});

test("a schema violation warns", () => {
  expect(parseDescriptions("[[session]]\nname = 3\n").warning).toBeDefined();
});

test("a valid file maps names to descriptions and skips entries without one", () => {
  const { descriptions, orders, warning } = parseDescriptions(
    [
      "[[session]]",
      'name = "Area A"',
      'path = "~/a"',
      'description = "First area"',
      "",
      "[[session]]",
      'name = "Area B"',
      "order = 0",
    ].join("\n"),
  );
  expect(warning).toBeUndefined();
  expect([...descriptions]).toEqual([["Area A", "First area"]]);
  expect([...orders]).toEqual([["Area B", 0]]);
});

test("ordered sessions sort first and move to the top of Rex's list", async () => {
  const live = (label: string): LiveSession => ({ id: `id-${label}`, label, tabs: [], cwds: [] });
  const orders = new Map([
    ["Inbox", 0],
    ["Area B", 1],
  ]);
  const sorted = sortSessions(
    [live("Area A"), live("Area B"), live("Area C"), live("Inbox")],
    orders,
  );
  expect(sorted.map((s) => s.label)).toEqual(["Inbox", "Area B", "Area A", "Area C"]);

  const calls: string[][] = [];
  const run: RexRunner = (argv) => {
    calls.push([...argv]);
    return Promise.resolve({ code: 0, stdout: "", stderr: "" });
  };
  await applyOrder(run, "host-b", sorted, orders);
  expect(calls).toEqual([
    ["rex", "-S", "host-b", "session", "move", "id-Inbox", "--index", "1"],
    ["rex", "-S", "host-b", "session", "move", "id-Area B", "--index", "2"],
  ]);
});

test("recent areas keep non-live labels from the last 14 days", () => {
  const rows = [
    row("2026-11-20T00:00:00Z", "Area A"),
    row("2026-11-20T00:00:00Z", "Area B"),
    row("2026-11-21T00:00:00Z", "Area B"),
    row("2026-11-01T00:00:00Z", "Area C"),
    row("2026-11-22T00:00:00Z"),
    row("not a date", "Area D"),
  ];
  expect(recentAreas(rows, new Set(["Area A"]), NOW)).toEqual(["Area B"]);
});

test("old ledger rows without rexSession stay valid", () => {
  const line = JSON.stringify({ ...row("2026-11-20T00:00:00Z") });
  expect(parseLedgerLine(line)).not.toBeNull();
  expect(parseLedgerLine(JSON.stringify(row("2026-11-20T00:00:00Z", "Area A")))).toMatchObject({
    rexSession: "Area A",
  });
});

function fakeRex(options: { failServer?: string } = {}): { run: RexRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: RexRunner = (argv) => Promise.resolve(respond(argv));
  const respond = (argv: readonly string[]): { code: number; stdout: string; stderr: string } => {
    calls.push([...argv]);
    const args = argv.slice(argv[1] === "-S" ? 3 : 1);
    if (argv[1] === "-S" && argv[2] === options.failServer)
      return { code: 1, stdout: "", stderr: "dial failed" };
    const ok = (value: unknown) => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });
    if (args[0] === "ls") return ok({ sessions: [{ session_id: "session:1", label: "Area A" }] });
    if (args[0] === "api")
      return ok({
        windows: [
          {
            label: "Tab One",
            layers: [{ blocks: [{ block_id: "block:1" }, { block_id: "block:2" }] }],
          },
          { label: "Tab Two", layers: [{ blocks: [{ block_id: "block:3" }] }] },
        ],
      });
    if (args.at(-1) === "process") {
      const id = args[args.indexOf("-b") + 1];
      if (id === "block:3") return ok({ foreground: null });
      return ok({ foreground: { cwd: "/work/a" } });
    }
    return ok({ pwd: "/work/home" });
  };
  return { run, calls };
}

test("live sessions gather tabs and distinct foreground cwds, falling back to pwd", async () => {
  const { run } = fakeRex();
  expect(await listLiveSessions(run)).toEqual([
    {
      id: "session:1",
      label: "Area A",
      tabs: ["Tab One", "Tab Two"],
      cwds: ["/work/a", "/work/home"],
    },
  ]);
});

test("an unreachable host raises HostUnreachableError and routes through -S", async () => {
  const { run, calls } = fakeRex({ failServer: "host-b" });
  const failure = await listLiveSessions(run, "host-b").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(HostUnreachableError);
  if (!(failure instanceof HostUnreachableError)) throw failure;
  expect(failure.message).toBe("host-b");
  expect(calls[0]).toEqual(["rex", "-S", "host-b", "ls", "--json"]);
});

test("the table lists each session with its description and the recent areas", () => {
  const output = renderSessions(
    [
      {
        id: "session:1",
        label: "Area A",
        tabs: ["Tab One", "Tab Two"],
        cwds: ["/work/a", "/work/b"],
      },
    ],
    new Map([
      ["Area A", "First area"],
      ["Area B", "Second area"],
    ]),
    ["Area B", "Area C"],
  );
  expect(output).toContain("SESSION");
  expect(output).toContain("Area A");
  expect(output).toContain("Tab One, Tab Two");
  expect(output).toContain("/work/a");
  expect(output).toContain("/work/b");
  expect(output).toContain("First area");
  expect(output).toContain("Recent areas");
  expect(output).toContain("  Area B: Second area");
  expect(output).toContain("  Area C\n");
});

test("the table omits the recent areas section when there are none", () => {
  expect(renderSessions([], new Map(), [])).not.toContain("Recent areas");
});

test.each<{
  name: string;
  env: Record<string, string>;
  inspect: { code: number; stdout: string } | null;
  expected: string | undefined;
}>([
  {
    name: "the block's session over an inherited REX_SESSION",
    env: { REX_BLOCK: "block:7", REX_SESSION: "session:old" },
    inspect: { code: 0, stdout: '{"session_id":"session:live","block":{}}' },
    expected: "session:live",
  },
  {
    name: "the block's session with no REX_SESSION",
    env: { REX_BLOCK: "block:7" },
    inspect: { code: 0, stdout: '{"session_id":"session:live"}' },
    expected: "session:live",
  },
  {
    name: "REX_SESSION once the block is gone",
    env: { REX_BLOCK: "block:7", REX_SESSION: "session:old" },
    inspect: { code: 1, stdout: "" },
    expected: "session:old",
  },
  {
    name: "nothing for a closed block and no REX_SESSION",
    env: { REX_BLOCK: "block:7" },
    inspect: { code: 1, stdout: "" },
    expected: undefined,
  },
  {
    name: "REX_SESSION without asking Rex when no block is set",
    env: { REX_SESSION: "session:old" },
    inspect: null,
    expected: "session:old",
  },
])("currentSession returns $name", async ({ env, inspect, expected }) => {
  const calls: string[] = [];
  const run: RexRunner = (argv) => {
    calls.push(argv.join(" "));
    return Promise.resolve({ code: inspect?.code ?? 1, stdout: inspect?.stdout ?? "", stderr: "" });
  };
  expect(await currentSession(env, run)).toBe(expected);
  expect(calls).toEqual(inspect == null ? [] : ["rex block inspect block:7 --json"]);
});
