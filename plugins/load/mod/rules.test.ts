import { describe, expect, test } from "claude-code/testing";
import { type Census, MAX_DAEMONS, browserCalls, judge } from "./browser";
import {
  type Machine,
  judge as judgeCaps,
  loadPerCore,
  parseCaps,
  plan as planCaps,
  pressureLevel,
  processes,
} from "./caps";
import { segments } from "./command";
import { level, reminder } from "./pace";

const calls = (command: string) => browserCalls(segments(command));
const { caps } = parseCaps([
  String.raw`build:2:\b(?:vite|ladle)(?:\.js)? build\b`,
  String.raw`build:2:\bpytest\b.* (?:-n ?|--numprocesses[ =])(?:auto|logical|\d+)\b`,
  String.raw`duckdb:3:(?:^|/)duckdb(?=\s|$)`,
]);
const plan = (command: string) => planCaps(caps, segments(command));

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

describe("caps", () => {
  test("parses pool:limit:regex entries and reports bad ones", () => {
    const parsed = parseCaps(["build:4:vite build", "nolimit:vite", "bad:1:(", "pool:2:a:b"]);
    expect(parsed.caps.map(({ pool, limit, pattern }) => [pool, limit, pattern.source])).toEqual([
      ["build", 4, "vite build"],
      ["pool", 2, "a:b"],
    ]);
    expect(parsed.invalid).toEqual(["nolimit:vite", "bad:1:("]);
  });

  test("plans capped jobs and finds parallel ones", () => {
    const cases: [string, string, { pools: string[]; isParallel: boolean }][] = [
      [
        "backgrounded in a loop",
        "for s in a b c d; do npx ladle build --outDir out/$s & done; wait",
        { pools: ["build"], isParallel: true },
      ],
      [
        "xargs -P",
        "echo a b | xargs -P4 -I{} npx ladle build --outDir {}",
        { pools: ["build"], isParallel: true },
      ],
      [
        "xargs -P1",
        "echo a b | xargs -P1 -I{} npx ladle build --outDir {}",
        { pools: ["build"], isParallel: false },
      ],
      [
        "quoted mentions",
        'git commit -m "fix vite build" & grep "ladle build" notes.md &',
        { pools: [], isParallel: false },
      ],
      [
        "two backgrounded",
        "vite build & npx ladle build & wait",
        { pools: ["build", "build"], isParallel: true },
      ],
      [
        "chained",
        "vite build && duckdb s.db 2>&1 | tail",
        { pools: ["build", "duckdb"], isParallel: false },
      ],
      ["pytest -n auto", "uv run pytest -n auto tests/", { pools: ["build"], isParallel: false }],
      ["uncapped", "uv run pytest tests/", { pools: [], isParallel: false }],
    ];
    for (const [name, command, expected] of cases) {
      expect({ name, plan: plan(command) }).toEqual({ name, plan: expected });
    }
    expect(planCaps([], segments("vite build & vite build"))).toEqual({
      pools: [],
      isParallel: false,
    });
  });

  test("counts each running job once per process tree, and Claude sessions", () => {
    const ps = [
      "  100     1 /Users/b/.local/bin/claude",
      "  101   100 /bin/zsh -c source snapshot && eval 'npx ladle build --outDir a'",
      "  102   101 npm exec ladle build --outDir a",
      "  103   102 node /repo/node_modules/.bin/ladle build --outDir a",
      "  200     1 claude --resume",
      "  201   200 /usr/local/bin/node /repo/node_modules/vite/bin/vite.js build",
      "  300   200 /Users/b/.local/share/mise/installs/duckdb/1.5.6/duckdb -readonly s.db",
      "  400     1 /bin/zsh",
    ].join("\n");
    expect(processes(caps, ps)).toEqual({ running: ["build", "build", "duckdb"], sessions: 2 });
  });

  test("reads load per core and memory pressure from sysctl", () => {
    expect(loadPerCore("{ 28.00 20.10 9.50 }\n14\n")).toBe(2);
    expect(loadPerCore("garbage")).toBeUndefined();
    expect(pressureLevel("{ 1.00 1.00 1.00 }\n10\n4\n")).toBe(4);
    expect(pressureLevel("{ 1.00 1.00 1.00 }\n10\n")).toBeUndefined();
  });

  test("refuses parallel, over-cap, out-of-memory, and saturated jobs", () => {
    const idle: Machine = { running: [], sessions: 1, loadPerCore: 0.5, pressure: 1 };
    const verdict = (command: string, machine: Partial<Machine> = {}, maxLoad = 3) =>
      judgeCaps(caps, plan(command), { ...idle, ...machine }, maxLoad).reason;
    expect(verdict("for s in a b; do npx ladle build & done")).toBe("parallel");
    expect(verdict("vite build", { running: ["build", "build"] })).toBe("running");
    expect(verdict("vite build", { running: ["duckdb", "duckdb", "duckdb"] })).toBeUndefined();
    expect(verdict("duckdb s.db", { running: ["duckdb", "duckdb", "duckdb"] })).toBe("running");
    expect(verdict("vite build", { pressure: 2 })).toBeUndefined();
    expect(verdict("vite build", { pressure: 4 })).toBe("pressure");
    expect(verdict("vite build", { loadPerCore: 4 })).toBe("load");
    expect(verdict("vite build", { loadPerCore: 4 }, 0)).toBeUndefined();
    expect(
      verdict("ls", { running: ["build", "build"], loadPerCore: 41, pressure: 4 }),
    ).toBeUndefined();
  });
});

describe("pace", () => {
  const calm: Machine = { running: [], sessions: 1, loadPerCore: 0.5, pressure: 1 };

  test("grades load against the pacing threshold, off at 0", () => {
    expect(level(calm, 1.5)).toBe(0);
    expect(level({ ...calm, loadPerCore: 1.5 }, 1.5)).toBe(1);
    expect(level({ ...calm, pressure: 2 }, 1.5)).toBe(1);
    expect(level({ ...calm, loadPerCore: 3 }, 1.5)).toBe(2);
    expect(level({ ...calm, pressure: 4 }, 1.5)).toBe(2);
    expect(level({ ...calm, loadPerCore: 9, pressure: 4 }, 0)).toBe(0);
  });

  test("tells the model what is loading the machine", () => {
    const busy = { running: ["build", "duckdb"], sessions: 4, loadPerCore: 1.84, pressure: 2 };
    expect(reminder(busy, 1)).toContain(
      "busy (load 1.8x its cores; warning memory pressure; 4 Claude sessions; running build, duckdb)",
    );
    expect(reminder({ ...calm, loadPerCore: 3.2 }, 2)).toContain("strained (load 3.2x its cores)");
    expect(reminder(calm, 0)).toBeUndefined();
  });
});
