import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "./compact-classifier-telemetry";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "compact-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true });
});

const RECORD = {
  session_id: "s1",
  tool_use_id: "toolu_1",
  agent_id: null,
  tool: "AskUserQuestion",
  decision: "ask",
  rule: null,
  reason: "Answer questions?",
  started_at: 1_000,
  check_ms: 5,
  duration_ms: 60_000,
  outcome: "ok",
};

async function seed(files: Record<string, string>) {
  await Promise.all(
    Object.entries(files).map(([name, text]) =>
      Bun.write(join(dir, "src", "s1", name), text, { createPath: true }),
    ),
  );
}

test("compacts a session's records into one mod-events file", async () => {
  await seed({ "toolu_1.json": `${JSON.stringify(RECORD)}\n`, "toolu_2.json": "" });
  await Bun.write(join(dir, "src", ".DS_Store"), "");

  const totals = await compact(join(dir, "src"), join(dir, "out"));

  expect(totals).toEqual({ sessions: 1, skipped: 0, records: 1, unreadable: 1 });
  const out = await Bun.file(join(dir, "out", "s1", "classifier-telemetry.legacy.0.jsonl")).text();
  expect(JSON.parse(out)).toMatchInlineSnapshot(`
    {
      "detail": {
        "agent_id": null,
        "check_ms": 5,
        "decision": "ask",
        "hook": null,
        "interactive": true,
        "outcome": "ok",
        "reason": "Answer questions?",
        "rule": null,
        "started_at": 1000,
        "tool": "AskUserQuestion",
        "tool_use_id": "toolu_1",
      },
      "event": "tool.verdict",
      "mod": "classifier-telemetry",
      "ms": 60000,
      "ok": true,
      "session": "s1",
      "ts": 61000,
    }
  `);
});

test("skips a session already compacted and writes nothing on a dry run", async () => {
  await seed({ "toolu_1.json": JSON.stringify(RECORD) });

  expect(await compact(join(dir, "src"), join(dir, "out"), true)).toMatchObject({ records: 1 });
  await compact(join(dir, "src"), join(dir, "out"));
  expect(await compact(join(dir, "src"), join(dir, "out"))).toMatchObject({ skipped: 1 });
});
