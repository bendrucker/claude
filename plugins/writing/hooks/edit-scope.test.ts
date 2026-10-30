import { describe, expect, it, test } from "bun:test";
import type { ValeAlert } from "../detection/vale";
import { type EditScope, editedAlerts, editScopeOf } from "./edit-scope";

function makeAlert(overrides: Partial<ValeAlert> = {}): ValeAlert {
  return {
    Check: "Writing.DigInto",
    Message: "",
    Severity: "warning",
    Line: 1,
    Span: [1, 1],
    Match: "dig into",
    ...overrides,
  };
}

describe("editScopeOf", () => {
  it("numbers added lines in the saved file past context and removed lines", () => {
    const scope = editScopeOf({
      structuredPatch: [
        { newStart: 3, lines: [" keep", "-old one", "-old two", "+new", " keep"] },
        { newStart: 10, lines: ["+first", " keep", "+second"] },
      ],
    });
    expect(scope).toEqual({
      added: new Map([
        [4, 0],
        [10, 1],
        [12, 1],
      ]),
      removed: ["old one\nold two", ""],
    });
  });

  test.each([
    { name: "a created file", response: { type: "create", structuredPatch: [] } },
    { name: "a response without a patch", response: {} },
    { name: "a malformed response", response: "edited" },
  ])("treats $name as wholly written", ({ response }) => {
    expect(editScopeOf(response)).toBeNull();
  });

  it("scopes an overwrite that changed nothing to no lines", () => {
    expect(editScopeOf({ type: "update", structuredPatch: [] })).toEqual({
      added: new Map(),
      removed: [],
    });
  });
});

describe("editedAlerts", () => {
  const scope: EditScope = {
    added: new Map([
      [4, 0],
      [5, 0],
    ]),
    removed: ["we should dig into it"],
  };

  test.each<{ name: string; alerts: ValeAlert[]; kept: number[] }>([
    {
      name: "an alert the edit introduced",
      alerts: [makeAlert({ Line: 4, Match: "deep dive" })],
      kept: [4],
    },
    { name: "an alert on a line the edit left alone", alerts: [makeAlert({ Line: 2 })], kept: [] },
    { name: "a match the hunk already removed", alerts: [makeAlert({ Line: 4 })], kept: [] },
    {
      name: "a match added beyond the ones removed",
      alerts: [makeAlert({ Line: 4 }), makeAlert({ Line: 5 })],
      kept: [5],
    },
  ])("handles $name", ({ alerts, kept }) => {
    expect(editedAlerts(alerts, scope).map((alert) => alert.Line)).toEqual(kept);
  });
});
