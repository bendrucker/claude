import { describe, expect, test } from "bun:test";
import type { PullRequest } from "./capture";
import { ago, agents, DAY, fixture, item, NOW, observe, pr, row } from "./fixture";
import { openItems, readQueue } from "./items";
import { readProjects } from "./projects";
import { buildStatus, formatAge, formatStatus, type Need, type Observed } from "./status";
import { type DispatchLedgerRow, readLedger } from "./threads";

describe("status", () => {
  test("renders the queue, the routing block, and the open threads", async () => {
    const dataDir = await fixture();
    const status = buildStatus(
      await readProjects(dataDir),
      await readLedger(dataDir),
      {},
      observe({ agents: agents(["wLD:p1", "lead-ledger", "idle"], ["wA:p1", "one-off", "idle"]) }),
      openItems(readQueue(dataDir)),
    );
    expect(status.projects).toMatchObject([{ slug: "ledger", lead: "live", open: 1 }]);
    expect(formatStatus(status, NOW)).toMatchSnapshot();
  });

  test("marks the lead unknown when herdr cannot answer, and the blocks empty when they are", () => {
    const none: DispatchLedgerRow[] = [];
    const status = buildStatus([{ slug: "p", name: "P", description: "d" }], none, {}, observe());
    expect(status.projects[0]?.lead).toBe("unknown");
    expect(formatStatus(status, NOW)).toMatchSnapshot();
    expect(formatStatus(buildStatus([], none, {}, observe()), NOW)).toBe(
      "queue\nno open items\n\nprojects\nno projects\n\nthreads\nno open threads\n",
    );
  });

  test("keeps every item on one line when a field carries newlines", () => {
    const status = buildStatus(
      [{ slug: "p", name: "P", description: "first line\nsecond  line\n" }],
      [row({ pr: "https://example.com/pr/1\nstray" })],
      {},
      observe(),
      [item({ text: "first\nsecond" })],
    );
    const lines = formatStatus(status, NOW).trimEnd().split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[2]).toContain("first second");
    expect(lines[5]).toContain("first line second line");
    expect(lines[9]).toContain("https://example.com/pr/1 stray");
  });
});

describe("formatAge", () => {
  test.each([
    ["2026-09-18T11:59:30.000Z", "0m"],
    ["2026-09-18T11:15:00.000Z", "45m"],
    ["2026-09-18T09:00:00.000Z", "3h"],
    ["2026-09-16T13:00:00.000Z", "47h"],
    ["2026-09-16T11:00:00.000Z", "2d"],
    ["2026-09-18T13:00:00.000Z", "0m"],
    ["yesterday", "?"],
  ])("%s reads as %s", (ts, expected) => {
    expect(formatAge(ts, NOW)).toBe(expected);
  });
});

describe("need", () => {
  const needOf = (overrides: Partial<DispatchLedgerRow>, observed: Observed): Need | undefined =>
    buildStatus([], [row(overrides)], {}, observed).threads[0]?.need;

  test("puts a pane herdr reports blocked ahead of everything else", () => {
    expect(
      needOf(
        { pr: "https://pr/1" },
        observe({
          agents: agents(["wZZ:p1", "fix-thing", "blocked"]),
          pullRequests: new Map([["https://pr/1", pr({ approved: true })]]),
        }),
      ),
    ).toBe("waiting-on-you");
  });

  test("waits on a dispatch that never delivered its prompt", () => {
    expect(
      needOf({ prompted: false }, observe({ agents: agents(["wZZ:p1", "fix-thing", "idle"]) })),
    ).toBe("waiting-on-you");
  });

  test("lets an agent that went to work settle its own delivery flag", () => {
    expect(
      needOf({ prompted: false }, observe({ agents: agents(["wZZ:p1", "fix-thing", "working"]) })),
    ).toBe("working");
  });

  test("keeps a recovered dispatch waiting while its agent sits blocked", () => {
    expect(
      needOf({ prompted: false }, observe({ agents: agents(["wZZ:p1", "fix-thing", "blocked"]) })),
    ).toBe("waiting-on-you");
  });

  test("follows an agent that moved to another pane", () => {
    expect(
      needOf({}, observe({ agents: agents(["wQQ:p9", "fix-thing", "working", "sess-1"]) })),
    ).toBe("working");
  });

  test("still reads a row with no session through its pane", () => {
    expect(
      needOf({ session: null }, observe({ agents: agents(["wZZ:p1", "fix-thing", "working"]) })),
    ).toBe("working");
  });

  test("waits on a dispatched thread whose agent is gone", () => {
    expect(needOf({}, observe({ agents: agents() }))).toBe("waiting-on-you");
  });

  test("waits on a thread the ledger records as blocked", () => {
    expect(
      needOf({ outcome: "blocked" }, observe({ agents: agents(["wZZ:p1", "fix-thing", "idle"]) })),
    ).toBe("waiting-on-you");
  });

  test("counts a pane holding a different agent as gone", () => {
    expect(needOf({}, observe({ agents: agents(["wZZ:p1", "someone-else", "idle"]) }))).toBe(
      "waiting-on-you",
    );
  });

  test("calls a week-old thread with no agent stale rather than waiting", () => {
    expect(needOf({ ts: ago(NOW, 8 * DAY) }, observe({ agents: agents() }))).toBe("stale");
    expect(needOf({ ts: ago(NOW, 6 * DAY) }, observe({ agents: agents() }))).toBe("waiting-on-you");
  });

  test("keeps a thread out of stale while its agent is still there", () => {
    expect(
      needOf(
        { ts: ago(NOW, 8 * DAY) },
        observe({ agents: agents(["wZZ:p1", "fix-thing", "working"]) }),
      ),
    ).toBe("working");
  });

  test.each<[string, Partial<DispatchLedgerRow>, Need]>([
    ["a decision it is still blocked on", { outcome: "blocked" }, "waiting-on-you"],
    ["a prompt that never reached it", { prompted: false }, "waiting-on-you"],
    ["a pull request waiting to be read", { pr: "https://pr/open" }, "ready-for-review"],
    ["a pull request already approved", { pr: "https://pr/approved" }, "landing"],
    ["nothing but its own age", {}, "stale"],
  ])("a week-old thread with no agent still reports %s", (_name, overrides, expected) => {
    expect(
      needOf(
        { ts: ago(NOW, 8 * DAY), ...overrides },
        observe({
          agents: agents(),
          pullRequests: new Map([
            ["https://pr/open", pr()],
            ["https://pr/approved", pr({ approved: true })],
          ]),
        }),
      ),
    ).toBe(expected);
  });

  test("reads an open unapproved pull request as ready for review", () => {
    expect(
      needOf(
        { pr: "https://pr/1" },
        observe({
          agents: agents(["wZZ:p1", "fix-thing", "idle"]),
          pullRequests: new Map([["https://pr/1", pr()]]),
        }),
      ),
    ).toBe("ready-for-review");
  });

  test("leaves a draft pull request with the agent that is still writing it", () => {
    expect(
      needOf(
        { pr: "https://pr/1" },
        observe({
          agents: agents(["wZZ:p1", "fix-thing", "working"]),
          pullRequests: new Map([["https://pr/1", pr({ draft: true })]]),
        }),
      ),
    ).toBe("working");
  });

  test.each<[string, PullRequest, string]>([
    ["approved", pr({ approved: true }), "pr approved"],
    ["merged", pr({ state: "merged" }), "pr merged, record the outcome"],
    ["closed", pr({ state: "closed" }), "pr closed, record the outcome"],
  ])("lands an open thread whose pull request is %s", (_label, state, note) => {
    const [thread] = buildStatus(
      [],
      [row({ pr: "https://pr/1", note: "needs a decision" })],
      {},
      observe({
        agents: agents(["wZZ:p1", "fix-thing", "idle"]),
        pullRequests: new Map([["https://pr/1", state]]),
      }),
    ).threads;
    expect(thread).toMatchObject({ need: "landing", note });
  });

  test("keeps a done thread while its pull request is open and drops it once it is not", () => {
    const done = row({ outcome: "done", pr: "https://pr/1" });
    const state = (value: PullRequest) =>
      buildStatus([], [done], {}, observe({ pullRequests: new Map([["https://pr/1", value]]) }))
        .threads;
    expect(state(pr())).toMatchObject([{ need: "ready-for-review" }]);
    expect(state(pr({ approved: true }))).toMatchObject([{ need: "landing" }]);
    expect(state(pr({ state: "merged" }))).toEqual([]);
    expect(state(pr({ state: "closed" }))).toEqual([]);
  });

  test("keeps a thread in hand when gh could not say what its pull request is", () => {
    const unknown = new Map([["https://pr/1", pr({ state: "unknown" })]]);
    expect(
      needOf(
        { pr: "https://pr/1" },
        observe({ agents: agents(["wZZ:p1", "fix-thing", "working"]), pullRequests: unknown }),
      ),
    ).toBe("working");
    expect(
      buildStatus(
        [],
        [row({ outcome: "done", pr: "https://pr/1" })],
        {},
        observe({
          pullRequests: unknown,
        }),
      ).threads,
    ).toMatchObject([{ need: "ready-for-review" }]);
  });

  test.each<[string, Need]>([
    ["working", "working"],
    ["idle", "idle"],
    ["done", "idle"],
    ["unknown", "idle"],
  ])("reports an agent herdr calls %s as %s", (status, expected) => {
    expect(needOf({}, observe({ agents: agents(["wZZ:p1", "fix-thing", status]) }))).toBe(expected);
  });

  test("never calls an agent gone when herdr could not be asked", () => {
    expect(needOf({ ts: ago(NOW, 30 * DAY) }, observe())).toBe("idle");
  });

  test("orders the threads by what they need", () => {
    const status = buildStatus(
      [],
      [
        row({ branch: "quiet" }),
        row({ branch: "held", outcome: "blocked" }),
        row({ branch: "busy", pane: "wZZ:p2", agent: "busy" }),
      ],
      {},
      observe({
        agents: agents(["wZZ:p1", "fix-thing", "idle"], ["wZZ:p2", "busy", "working"]),
      }),
    );
    expect(status.threads.map((thread) => [thread.branch, thread.need])).toEqual([
      ["held", "waiting-on-you"],
      ["busy", "working"],
      ["quiet", "idle"],
    ]);
  });
});
