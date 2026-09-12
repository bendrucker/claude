import { describe, expect, it } from "bun:test";
import { APPEND_ONLY_REASON, DENY_REASON, growthReason, sizeReason } from "../../../hooks/gate";
import { bySession, caseId, classifyResponse, type Present } from "./decisions";

describe("classifyResponse", () => {
  it.each([
    ["size, 10k era", sizeReason(0), "gate:size"],
    ["size, re-armed", sizeReason(1), "gate:size"],
    [
      "size, 12k era",
      "This plan exceeds 12k characters. Plans this large are rarely approved",
      "gate:size",
    ],
    ["growth", growthReason(2, 8000, 9000), "gate:growth"],
    ["append-only", APPEND_ONLY_REASON, "gate:append-only"],
    [
      "append-only, 12k era",
      "This re-present carries nearly every prior line. A plan",
      "gate:append-only",
    ],
    [
      "unchanged, 12k era",
      "Plan text is byte-identical to the presentation that was just rejected.",
      "gate:unchanged",
    ],
    ["unchanged", DENY_REASON, "gate:unchanged"],
    ["approved", "User has approved your plan. You can now start coding.", "approved"],
    [
      "approved plan mentioning a rule phrase",
      "User has approved your plan.\n\n## Approved Plan:\nEvery keyed request came back byte-identical to the unkeyed one.",
      "approved",
    ],
    [
      "plannotator feedback",
      "YOUR PLAN WAS NOT APPROVED.\n\nYou MUST revise the plan",
      "user:rejected",
    ],
    [
      "rejected with feedback",
      "The user doesn't want to proceed with this tool use. To tell you how to proceed, the user said:\nsplit it",
      "user:rejected",
    ],
    [
      "rejected silently",
      "The user doesn't want to proceed with this tool use. STOP what you are doing and wait for the user to tell you how to proceed.",
      "user:rejected-silent",
    ],
    ["no result", null, "none"],
    ["something else", "Tool ran without output", "unknown"],
  ])("%s", (_label, response, expected) => {
    expect(classifyResponse(response)).toBe(expected);
  });
});

function present(overrides: Partial<Present>): Present {
  return {
    host: "local",
    session_id: "0123456789abcdef",
    session: "01234567",
    project_path: null,
    timestamp: "2026-09-01 00:00:00",
    seq: 1,
    chars: 4,
    plan: "plan",
    plan_file: null,
    model: null,
    response: null,
    actual: "none",
    ...overrides,
  };
}

describe("bySession", () => {
  it("groups by host and session in presentation order", () => {
    const grouped = bySession([
      present({ seq: 2 }),
      present({ host: "work", seq: 1 }),
      present({ seq: 1 }),
    ]);
    expect([...grouped.keys()]).toEqual(["local:0123456789abcdef", "work:0123456789abcdef"]);
    expect(grouped.get("local:0123456789abcdef")?.map((p) => p.seq)).toEqual([1, 2]);
  });
});

it("names a case by session prefix and sequence", () => {
  expect(caseId(present({ seq: 3 }))).toBe("01234567-seq3");
});
