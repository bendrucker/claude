import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { Resolution } from "./capture";
import type { CommandResult, Runner } from "./dispatch";
import { fixture, item, NOW } from "./fixture";
import {
  answerItem,
  appendItem,
  clearItem,
  latestItems,
  openItems,
  pushItem,
  queuePath,
  type QueueItem,
  readQueue,
  resolveLanded,
} from "./items";

const dir = (): string => mkdtempSync(join(tmpdir(), "queue-"));

const record = (
  result: CommandResult = { code: 0, stdout: "", stderr: "" },
): { calls: string[][]; run: Runner } => {
  const calls: string[][] = [];
  return {
    calls,
    run: (argv) => {
      calls.push([...argv]);
      return Promise.resolve(result);
    },
  };
};

const landed =
  (states: Record<string, Resolution>) =>
  (urls: readonly string[]): Promise<ReadonlyMap<string, Resolution>> =>
    Promise.resolve(new Map(urls.flatMap((url) => (url in states ? [[url, states[url]!]] : []))));

describe("readQueue", () => {
  test("skips lines that are not rows and reports each one", async () => {
    const dataDir = dir();
    const good = item({});
    await Bun.write(
      queuePath(dataDir),
      `${JSON.stringify(good)}\nnot json\n{"id":"q9"}\n\n${JSON.stringify(good)}\n`,
    );
    const warnings: string[] = [];
    expect(readQueue(dataDir, (message) => warnings.push(message))).toEqual([good, good]);
    expect(warnings[0]).toMatch(/:2: not JSON/);
    expect(warnings[1]).toMatch(/:3: /);
  });

  test("is empty without a file", () => {
    expect(readQueue(dir())).toEqual([]);
  });
});

describe("push", () => {
  test("hands out sequential ids and records where the item came from", () => {
    const dataDir = dir();
    const first = pushItem({ kind: "review", text: "read the diff" }, dataDir, () => NOW);
    expect(first).toEqual({
      id: "q1",
      ts: NOW.toISOString(),
      kind: "review",
      text: "read the diff",
      state: "open",
    });
    const second = pushItem(
      {
        kind: "question",
        text: "which base?",
        url: "https://example.test/pr/2",
        thread: { repo: "/repo", branch: "fix-thing" },
        agent: "fix-thing",
        pane: "wZZ:p1",
      },
      dataDir,
      () => NOW,
    );
    expect(second).toMatchObject({ id: "q2", agent: "fix-thing", pane: "wZZ:p1" });
    expect(readQueue(dataDir)).toHaveLength(2);
  });

  test("skips an id a row too broken to parse already holds", async () => {
    const dataDir = dir();
    await Bun.write(queuePath(dataDir), `{"id":"q7","state":"nonsense"}\n`);
    expect(pushItem({ kind: "review", text: "read it" }, dataDir).id).toBe("q8");
  });

  test("gives concurrent pushes distinct ids", async () => {
    const dataDir = dir();
    const script = join(import.meta.dir, "queue.ts");
    const pushes = Array.from({ length: 6 }, (_, index) =>
      Bun.spawn([process.execPath, script, "ask", "--data-dir", dataDir, `question ${index}`], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    await Promise.all(pushes.map((proc) => proc.exited));
    const ids = readQueue(dataDir).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(6);
  });

  test.each([
    ["an empty text", "", /cannot be empty/],
    ["a text too long to keep a row's ceiling", "w".repeat(501), /at most 500 characters/],
  ])("refuses %s", (_label, text, expected) => {
    expect(() => pushItem({ kind: "review", text }, dir())).toThrow(expected);
  });
});

describe("folding", () => {
  test("keeps the latest row per id and leaves only the open ones waiting", async () => {
    const rows = readQueue(await fixture());
    expect(latestItems(rows).map((entry) => [entry.id, entry.state])).toEqual([
      ["q1", "open"],
      ["q2", "open"],
      ["q3", "answered"],
    ]);
    expect(openItems(rows).map((entry) => entry.id)).toEqual(["q1", "q2"]);
  });

  test("puts the longest wait first", () => {
    const rows = [
      item({ id: "q1", ts: "2026-09-18T11:00:00.000Z" }),
      item({ id: "q2", ts: "2026-09-18T09:00:00.000Z" }),
      item({ id: "q3", ts: "not a date" }),
    ];
    expect(openItems(rows).map((entry) => entry.id)).toEqual(["q3", "q2", "q1"]);
  });
});

describe("clearing", () => {
  const raised = (overrides: Partial<QueueItem> = {}): string => {
    const dataDir = dir();
    appendItem(item({ id: "q1", ...overrides }), dataDir);
    return dataDir;
  };

  test("carries the item's identity onto the closing row", () => {
    const dataDir = raised({ agent: "fix-thing", url: "https://example.test/pr/1" });
    const cleared = clearItem({ id: "q1", state: "acked", by: "lead-ledger" }, dataDir, () => NOW);
    expect(cleared).toEqual({
      id: "q1",
      ts: NOW.toISOString(),
      kind: "question",
      text: "which base branch?",
      state: "acked",
      by: "lead-ledger",
      agent: "fix-thing",
      url: "https://example.test/pr/1",
    });
    expect(openItems(readQueue(dataDir))).toEqual([]);
  });

  test.each([["acked" as const], ["answered" as const], ["resolved" as const]])(
    "refuses an item already %s",
    (state) => {
      const dataDir = raised();
      clearItem({ id: "q1", state, by: "ben" }, dataDir);
      expect(() => clearItem({ id: "q1", state: "acked", by: "ben" }, dataDir)).toThrow(
        `q1 is already ${state}`,
      );
    },
  );

  test("refuses an id the queue never saw", () => {
    expect(() => clearItem({ id: "q9", state: "acked", by: "ben" }, raised())).toThrow(
      /no queue item q9 in /,
    );
  });

  test("delivers an answer to the agent that asked and records that it landed", async () => {
    const dataDir = raised({ agent: "fix-thing" });
    const { calls, run } = record();
    const answered = await answerItem("q1", "use the lock", "ben", dataDir, run);
    expect(calls).toEqual([["herdr", "agent", "prompt", "fix-thing", "use the lock"]]);
    expect(answered).toMatchObject({
      state: "answered",
      answer: "use the lock",
      delivered: true,
      by: "ben",
    });
  });

  test.each<[string, Partial<QueueItem>, CommandResult, number]>([
    ["no agent to deliver to", {}, { code: 0, stdout: "", stderr: "" }, 0],
    ["a herdr that refused", { agent: "gone" }, { code: 1, stdout: "", stderr: "no agent" }, 1],
  ])("records the answer anyway given %s", async (_label, overrides, result, sent) => {
    const dataDir = raised(overrides);
    const { calls, run } = record(result);
    const answered = await answerItem("q1", "go ahead", "ben", dataDir, run);
    expect(calls).toHaveLength(sent);
    expect(answered).toMatchObject({ answer: "go ahead", delivered: false });
  });

  test("refuses an answer too long to keep a row's ceiling", async () => {
    let message = "";
    try {
      await answerItem("q1", "w".repeat(501), "ben", raised(), record().run);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/at most 500 characters/);
  });
});

describe("resolveLanded", () => {
  const review = (url?: string): QueueItem => item({ id: "q1", kind: "review", url });

  const dataDirWith = (...rows: readonly QueueItem[]): string => {
    const dataDir = dir();
    for (const row of rows) appendItem(row, dataDir);
    return dataDir;
  };

  test("clears a review whose pull request landed and says the pr did it", async () => {
    const url = "https://github.com/bendrucker/claude/pull/1";
    const dataDir = dataDirWith(review(url));
    const left = await resolveLanded(
      openItems(readQueue(dataDir)),
      dataDir,
      landed({ [url]: "closed" }),
      () => NOW,
    );
    expect(left).toEqual([]);
    expect(readQueue(dataDir).at(-1)).toMatchObject({
      id: "q1",
      state: "resolved",
      by: "pr",
      ts: NOW.toISOString(),
    });
  });

  test.each<[string, Resolution]>([
    ["still open", "open"],
    ["one nothing could read", "unknown"],
  ])("leaves a review pointing at %s standing", async (_label, state) => {
    const url = "https://github.com/bendrucker/claude/issues/1";
    const dataDir = dataDirWith(review(url));
    const left = await resolveLanded(
      openItems(readQueue(dataDir)),
      dataDir,
      landed({ [url]: state }),
    );
    expect(left.map((entry) => entry.id)).toEqual(["q1"]);
    expect(readQueue(dataDir)).toHaveLength(1);
  });

  test("looks up nothing for a queue that points at no request", async () => {
    const dataDir = dataDirWith(review(), item({ id: "q2" }));
    const calls: (readonly string[])[] = [];
    const left = await resolveLanded(openItems(readQueue(dataDir)), dataDir, (urls) => {
      calls.push(urls);
      return Promise.resolve(new Map());
    });
    expect(calls).toEqual([]);
    expect(left.map((entry) => entry.id)).toEqual(["q1", "q2"]);
  });

  test("leaves a question alone even when its url landed", async () => {
    const url = "https://github.com/bendrucker/claude/pull/1";
    const dataDir = dataDirWith(item({ id: "q1", url }));
    const left = await resolveLanded(
      openItems(readQueue(dataDir)),
      dataDir,
      landed({ [url]: "closed" }),
    );
    expect(left.map((entry) => entry.id)).toEqual(["q1"]);
  });
});
