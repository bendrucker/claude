import { describe, expect, it } from "bun:test";
import type { Present } from "./decisions";
import { changed, replay, replayDecision, type ReplayRow } from "./replay";

function present(session: string, seq: number, plan: string, actual = "none"): Present {
  return {
    host: "local",
    session_id: `${session}-session`,
    session,
    project_path: null,
    timestamp: `2026-09-01 00:00:0${seq}`,
    seq,
    chars: plan.length,
    plan,
    plan_file: null,
    model: null,
    response: null,
    actual,
  };
}

const oversized = `# Plan\n${"x".repeat(10_100)}\n`;
const small = "# Plan\n\nsmall\n";

describe("replay", () => {
  it("decides each session's presents in order with isolated state", async () => {
    const rows = await replay([
      present("aaaaaaaa", 2, small),
      present("aaaaaaaa", 1, small, "user:rejected"),
      present("bbbbbbbb", 1, oversized, "gate:size"),
      present("bbbbbbbb", 2, small),
    ]);
    const decisions = new Map(rows.map((row) => [row.id, row.replay]));
    expect(decisions.get("aaaaaaaa-seq1")).toBe("none");
    expect(decisions.get("aaaaaaaa-seq2")).toBe("gate:unchanged");
    expect(decisions.get("bbbbbbbb-seq1")).toBe("gate:size");
    expect(decisions.get("bbbbbbbb-seq2")).toBe("none");
  });
});

it("maps a deny reason to its rule", () => {
  expect(replayDecision(undefined)).toBe("none");
  expect(replayDecision("This plan exceeds 10k characters.")).toBe("gate:size");
  expect(replayDecision("something new")).toBe("unknown");
});

it("lists only the decisions that moved against a baseline", () => {
  const row = (id: string, decision: string): ReplayRow => ({
    id,
    host: "local",
    chars: 1,
    actual: "none",
    replay: decision,
  });
  const baseline = [row("a", "gate:growth"), row("b", "gate:size"), row("c", "none")];
  const now = [row("a", "gate:size"), row("b", "gate:size"), row("d", "none")];
  expect(changed(now, baseline).map((r) => r.id)).toEqual(["a"]);
});
