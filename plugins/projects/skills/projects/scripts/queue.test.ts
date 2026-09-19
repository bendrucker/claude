import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { fixture } from "./fixture";
import { openItems, readQueue } from "./items";

describe("cli", () => {
  const script = join(import.meta.dir, "queue.ts");

  // An empty PATH keeps herdr and gh out of reach, so no answer is delivered
  // and nothing auto-resolves.
  const run = async (...args: string[]) => {
    const proc = Bun.spawn([process.execPath, script, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: "/nonexistent" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, code };
  };

  const dir = (): string => mkdtempSync(join(tmpdir(), "queue-cli-"));

  test("raises a review and a question, then lists both oldest first", async () => {
    const dataDir = dir();
    const review = await run(
      "push",
      "--review",
      "--data-dir",
      dataDir,
      "--url",
      "https://example.test/pr/1",
      "--repo",
      "/repo",
      "--branch",
      "fix-thing",
      "read the diff",
    );
    expect(review.code).toBe(0);
    expect(JSON.parse(review.stdout)).toMatchObject({
      id: "q1",
      kind: "review",
      text: "read the diff",
      state: "open",
      thread: { repo: "/repo", branch: "fix-thing" },
    });

    const question = await run("ask", "--data-dir", dataDir, "--agent", "fix-thing", "which base?");
    expect(JSON.parse(question.stdout)).toMatchObject({
      id: "q2",
      kind: "question",
      agent: "fix-thing",
    });

    const list = await run("list", "--data-dir", dataDir);
    expect(list.stdout).toMatch(/^id\s+kind\s+age\s+thread\s+text\s+url\n/);
    expect(list.stdout).toMatch(/\nq1\s+review\s+\S+\s+fix-thing\s+read the diff/);
    expect(list.stdout).toMatch(/\nq2\s+question/);

    const json = await run("list", "--data-dir", dataDir, "--json");
    expect(JSON.parse(json.stdout)).toMatchObject([{ id: "q1" }, { id: "q2" }]);
  });

  test("says so when nothing is waiting", async () => {
    expect((await run("list", "--data-dir", dir())).stdout).toBe("no open items\n");
  });

  test("acks an item and takes it off the list", async () => {
    const dataDir = await fixture(new Date());
    const acked = await run("ack", "q2", "--data-dir", dataDir, "--by", "lead-ledger");
    expect(acked.code).toBe(0);
    expect(JSON.parse(acked.stdout)).toMatchObject({ id: "q2", state: "acked", by: "lead-ledger" });
    expect(openItems(readQueue(dataDir)).map((item) => item.id)).toEqual(["q1"]);
  });

  test("records an answer herdr could not deliver", async () => {
    const dataDir = await fixture(new Date());
    const answered = await run("answer", "q2", "--data-dir", dataDir, "use", "the", "lock");
    expect(answered.code).toBe(0);
    expect(JSON.parse(answered.stdout)).toMatchObject({
      id: "q2",
      state: "answered",
      answer: "use the lock",
      delivered: false,
      by: "ben",
    });
  });

  test.each<[string, string[], number, RegExp]>([
    ["no subcommand", [], 2, /queue/],
    ["push without a kind", ["push", "anything"], 2, /--review is required/],
    ["a thread named by half", ["ask", "--repo", "/repo", "anything"], 2, /--repo and --branch/],
    ["an id the queue never saw", ["ack", "q9"], 1, /no queue item q9/],
    ["an item already cleared", ["ack", "q3"], 1, /q3 is already answered/],
  ])("rejects %s", async (_label, args, status, expected) => {
    const dataDir = await fixture(new Date());
    const result = await run(...args, "--data-dir", dataDir);
    expect(result.code).toBe(status);
    expect(`${result.stdout}${result.stderr}`).toMatch(expected);
  });
});
