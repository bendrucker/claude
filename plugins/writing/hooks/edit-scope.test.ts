import { describe, expect, it, test } from "bun:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import type { ValeAlert } from "../detection/vale";
import { editScopeOf, newAlerts } from "./edit-scope";

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

const alerts = gs.arrays(
  gs.composite((tc) =>
    makeAlert({
      Check: tc.draw(gs.sampledFrom(["Writing.DigInto", "Writing.SemicolonSplice"])),
      Match: tc.draw(gs.sampledFrom(["dig into", "; it", ""])),
      Line: tc.draw(gs.integers({ minValue: 1, maxValue: 5 })),
    }),
  ),
  { maxSize: 8 },
);

describe("editScopeOf", () => {
  it("numbers added lines in the saved file past context and removed lines", () => {
    const scope = editScopeOf({
      originalFile: "before\n",
      structuredPatch: [
        { newStart: 3, lines: [" keep", "-old one", "-old two", "+new", " keep"] },
        { newStart: 10, lines: ["+first", " keep", "+second"] },
      ],
    });
    expect(scope).toEqual({ original: "before\n", added: new Set([4, 10, 12]) });
  });

  test.each<{ name: string; response: unknown }>([
    {
      name: "a created file",
      response: { type: "create", originalFile: null, structuredPatch: [] },
    },
    { name: "a response without the original", response: { structuredPatch: [] } },
    { name: "a malformed response", response: "edited" },
  ])("treats $name as wholly written", ({ response }) => {
    expect(editScopeOf(response)).toBeNull();
  });
});

describe("newAlerts", () => {
  test.each<{ name: string; after: ValeAlert[]; before: ValeAlert[]; kept: number[] }>([
    {
      name: "an alert the original never raised",
      after: [makeAlert({ Line: 7 })],
      before: [],
      kept: [7],
    },
    {
      name: "an alert the original raised on another line",
      after: [makeAlert({ Line: 7 })],
      before: [makeAlert({ Line: 2 })],
      kept: [],
    },
    {
      name: "a second occurrence, preferring the one on an added line",
      after: [makeAlert({ Line: 2 }), makeAlert({ Line: 4 })],
      before: [makeAlert({ Line: 2 })],
      kept: [4],
    },
    {
      name: "the same text under another check",
      after: [makeAlert({ Check: "Writing.Other" })],
      before: [makeAlert()],
      kept: [1],
    },
  ])("handles $name", ({ after, before, kept }) => {
    expect(newAlerts(after, before, new Set([4])).map((alert) => alert.Line)).toEqual(kept);
  });

  test("keeps every alert against an empty original and none against itself", () => {
    hegel.test((tc) => {
      const after = tc.draw(alerts);
      const added = new Set(tc.draw(gs.arrays(gs.integers({ minValue: 1, maxValue: 5 }))));
      expect(newAlerts(after, [], added)).toEqual(after);
      expect(newAlerts(after, after, added)).toEqual([]);
    });
  });
});
