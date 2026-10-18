import { describe, expect, test } from "claude-code/testing";
import { type Census, MAX_DAEMONS, browserCalls, judge } from "./browser";
import { judgeBuilds, loadPerCore, planBuilds, pressureLevel, runningBuilds } from "./builds";
import { segments } from "./command";

const calls = (command: string) => browserCalls(segments(command));
const plan = (command: string) => planBuilds(segments(command));

function makeCensus(overrides: Partial<Census> = {}): Census {
  return { live: new Set(), pending: new Set(), mine: new Set(), others: new Set(), ...overrides };
}

describe("browserCalls", () => {
  test("reads each invocation's session and effect", () => {
    const cases: [string, string, unknown][] = [
      [
        "default session",
        "agent-browser open https://x.test",
        [{ session: "default", effect: "launch" }],
      ],
      [
        "--session",
        "agent-browser --session ev-1 snapshot -i",
        [{ session: "ev-1", effect: "launch" }],
      ],
      [
        "--session=",
        "agent-browser --session=ev-1 open x",
        [{ session: "ev-1", effect: "launch" }],
      ],
      [
        "env prefix",
        "AGENT_BROWSER_SESSION=mk agent-browser open x",
        [{ session: "mk", effect: "launch" }],
      ],
      ["npx", "npx agent-browser --session a open x", [{ session: "a", effect: "launch" }]],
      ["npx -y", "npx -y agent-browser --session a open x", [{ session: "a", effect: "launch" }]],
      [
        "timeout and env",
        "timeout -s KILL 60 env X=1 agent-browser --session a open x",
        [{ session: "a", effect: "launch" }],
      ],
      [
        "valued flag before subcommand",
        "agent-browser --profile Default open x",
        [{ session: "default", effect: "launch" }],
      ],
      ["close", "agent-browser --session a close", [{ session: "a", effect: "close" }]],
      ["close --all", "agent-browser close --all", [{ session: "default", effect: "close-all" }]],
      [
        "session list",
        "agent-browser session list --json",
        [{ session: "default", effect: "none" }],
      ],
      ["skills", "agent-browser skills get core", [{ session: "default", effect: "none" }]],
      ["help flag", "agent-browser open --help", [{ session: "default", effect: "none" }]],
      [
        "chain",
        "agent-browser --session a open x && agent-browser --session a close",
        [
          { session: "a", effect: "launch" },
          { session: "a", effect: "close" },
        ],
      ],
      [
        "loop body",
        "for u in a b; do agent-browser --session a open $u; done",
        [{ session: "a", effect: "launch" }],
      ],
      ["brace group", "{ agent-browser --session a close; }", [{ session: "a", effect: "close" }]],
      ["quoted mention", 'echo "agent-browser open x"', []],
      ["other program", "grep agent-browser notes.md", []],
    ];
    for (const [name, command, expected] of cases) {
      expect({ name, calls: calls(command) }).toEqual({ name, calls: expected });
    }
  });
});

describe("judge", () => {
  test("lets an agent reuse its own or another live session", () => {
    const live = new Set(["a", "b", "c"]);
    expect(
      judge(calls("agent-browser --session a open x"), makeCensus({ live, mine: new Set(["a"]) })),
    ).toEqual({});
    expect(
      judge(
        calls("agent-browser --session b snapshot"),
        makeCensus({ live, mine: new Set(["a"]) }),
      ),
    ).toEqual({});
  });

  test("refuses a second session for an agent that holds one", () => {
    const verdict = judge(
      calls("agent-browser --session mk-2 open x"),
      makeCensus({ live: new Set(["mk-1"]), mine: new Set(["mk-1"]) }),
    );
    expect(verdict.reason).toBe("owned");
    expect(verdict.deny).toContain("--session mk-1");
  });

  test("refuses one launch command that opens two sessions", () => {
    const verdict = judge(
      calls("agent-browser --session a open x; agent-browser --session b open y"),
      makeCensus(),
    );
    expect(verdict.reason).toBe("owned");
  });

  test("refuses a launch at the machine-wide cap, pending launches included", () => {
    const live = new Set(["x", "y"]);
    const atCap = makeCensus({ live, pending: new Set(["z"]) });
    expect(live.size + 1).toBe(MAX_DAEMONS);
    expect(judge(calls("agent-browser --session new open x"), atCap).reason).toBe("cap");
    expect(judge(calls("agent-browser --session new open x"), makeCensus({ live }))).toEqual({});
  });

  test("refuses a session named by a shell expansion", () => {
    const loop = calls("for i in 1 2 3; do agent-browser --session s$i open u; done");
    expect(judge(loop, makeCensus()).reason).toBe("dynamic");
  });

  test("refuses close --all only while others' sessions are live", () => {
    const all = calls("agent-browser close --all");
    expect(judge(all, makeCensus({ others: new Set(["theirs"]) })).reason).toBe("close-all");
    expect(judge(all, makeCensus({ mine: new Set(["mine"]) }))).toEqual({});
  });
});

describe("builds", () => {
  test("finds parallel heavy builds", () => {
    const cases: [string, string, { kinds: string[]; isParallel: boolean }][] = [
      [
        "backgrounded in a loop",
        "for s in a b c d; do npx ladle build --outDir out/$s & done; wait",
        { kinds: ["ladle"], isParallel: true },
      ],
      [
        "xargs -P",
        "echo a b | xargs -P4 -I{} npx ladle build --outDir {}",
        { kinds: ["ladle"], isParallel: true },
      ],
      [
        "xargs -P1",
        "echo a b | xargs -P1 -I{} npx ladle build --outDir {}",
        { kinds: ["ladle"], isParallel: false },
      ],
      [
        "mentions, not builds",
        'git commit -m "fix vite build" & grep "ladle build" notes.md &',
        { kinds: [], isParallel: false },
      ],
      [
        "two backgrounded",
        "vite build & npx ladle build & wait",
        { kinds: ["vite", "ladle"], isParallel: true },
      ],
      [
        "sequential loop",
        "for s in a b; do npx ladle build --outDir out/$s; done",
        { kinds: ["ladle"], isParallel: false },
      ],
      [
        "chained",
        "vite build && npx ladle build 2>&1 | tail",
        { kinds: ["vite", "ladle"], isParallel: false },
      ],
      ["one in background", "npx ladle build &", { kinds: ["ladle"], isParallel: false }],
      [
        "pytest -n auto",
        "uv run pytest -n auto tests/",
        { kinds: ["pytest-xdist"], isParallel: false },
      ],
      ["pytest serial", "uv run pytest tests/", { kinds: [], isParallel: false }],
      ["dev server", "npx ladle serve", { kinds: [], isParallel: false }],
      ["vitest run", "bunx vitest run src", { kinds: ["vitest"], isParallel: false }],
      ["vitest watch", "bunx vitest --watch", { kinds: [], isParallel: false }],
      ["jest", "npx jest --ci", { kinds: ["jest"], isParallel: false }],
      ["jest in band", "npx jest -i", { kinds: [], isParallel: false }],
      ["playwright", "npx playwright test e2e", { kinds: ["playwright"], isParallel: false }],
      ["duckdb cli", "duckdb -readonly s.db < q.sql", { kinds: ["duckdb"], isParallel: false }],
      [
        "session index",
        "bun ~/.claude/plugins/marketplaces/bendrucker/plugins/observability/skills/session/scripts/query.ts tools",
        { kinds: ["session-index"], isParallel: false },
      ],
    ];
    for (const [name, command, expected] of cases) {
      expect({ name, plan: plan(command) }).toEqual({ name, plan: expected });
    }
  });

  test("counts each running build once, not its wrappers", () => {
    const ps = [
      "/bin/zsh -c source snapshot && eval 'npx ladle build --outDir a'",
      "npm exec ladle build --outDir a",
      "bun x vite build",
      "node /repo/node_modules/.bin/ladle build --outDir a",
      "/usr/local/bin/node /repo/node_modules/vite/bin/vite.js build",
      "/repo/.venv/bin/python /repo/.venv/bin/pytest -n auto",
      "grep ladle build",
      "node /repo/node_modules/vitest/vitest.mjs run",
      "node /repo/node_modules/vitest/dist/workers/forks.js",
      "node /repo/node_modules/jest-worker/build/processChild.js",
      "/Users/b/.local/share/mise/installs/duckdb/1.5.6/duckdb -readonly s.db",
    ].join("\n");
    expect(runningBuilds(ps)).toEqual(["ladle", "vite", "pytest-xdist", "vitest", "duckdb"]);
  });

  test("reads load per core from sysctl", () => {
    expect(loadPerCore("{ 28.00 20.10 9.50 }\n14\n")).toBe(2);
    expect(loadPerCore("garbage")).toBeUndefined();
  });

  test("reads the memory pressure level, absent off macOS", () => {
    expect(pressureLevel("{ 1.00 1.00 1.00 }\n10\n4\n")).toBe(4);
    expect(pressureLevel("{ 1.00 1.00 1.00 }\n10\n")).toBeUndefined();
  });

  test("refuses parallel, overlapping, and saturated builds", () => {
    const one = plan("npx ladle build");
    const idle = { running: [], loadPerCore: 0.5, pressure: 1 };
    expect(judgeBuilds(plan("for s in a b; do npx ladle build & done"), idle).reason).toBe(
      "parallel",
    );
    expect(judgeBuilds(one, { ...idle, running: ["ladle", "vite"] }).reason).toBe("running");
    expect(judgeBuilds(one, { ...idle, loadPerCore: 41 }).reason).toBe("load");
    expect(judgeBuilds(one, idle)).toEqual({});
    expect(judgeBuilds(plan("ls"), { ...idle, running: ["a", "b", "c"], loadPerCore: 41 })).toEqual(
      {},
    );
  });

  test("bounds DuckDB in its own pool and shrinks pools under memory pressure", () => {
    const duckdb = plan("duckdb s.db < q.sql");
    const idle = { running: [], loadPerCore: 0.5, pressure: 1 };
    expect(judgeBuilds(duckdb, { ...idle, running: ["vite", "ladle"] })).toEqual({});
    expect(judgeBuilds(duckdb, { ...idle, running: ["duckdb", "session-index"] })).toEqual({});
    expect(
      judgeBuilds(duckdb, { ...idle, running: ["duckdb", "duckdb", "session-index"] }).reason,
    ).toBe("running");
    const warn = judgeBuilds(duckdb, { ...idle, running: ["duckdb"], pressure: 2 });
    expect(warn.reason).toBe("running");
    expect(warn.deny).toContain("under pressure");
    expect(judgeBuilds(duckdb, { ...idle, pressure: 2 })).toEqual({});
    expect(judgeBuilds(duckdb, { ...idle, pressure: 4 }).reason).toBe("pressure");
  });
});
