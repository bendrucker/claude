import { describe, expect, it } from "bun:test";
import type { ValeAlert } from "../detection/vale";
import { editScopeOf, inScope } from "./edit-scope";

function alert(Line: number, Match: string): ValeAlert {
  return { Check: "Writing.DigInto", Message: "", Severity: "warning", Line, Span: [1, 1], Match };
}

describe("editScopeOf", () => {
  it("numbers added lines in the saved file past context and removed lines", () => {
    const scope = editScopeOf({
      structuredPatch: [
        { newStart: 3, lines: [" keep", "-old one", "-old two", "+new", " keep"] },
        { newStart: 10, lines: ["+first", " keep", "+second"] },
      ],
    });
    expect(scope).toEqual(
      new Map([
        [4, "old one\nold two"],
        [10, ""],
        [12, ""],
      ]),
    );
  });

  it.each([
    { name: "a created file", response: { type: "create", structuredPatch: [] } },
    { name: "a response without a patch", response: {} },
    { name: "a malformed response", response: "edited" },
  ])("treats $name as wholly written", ({ response }) => {
    expect(editScopeOf(response)).toBeNull();
  });

  it("scopes an overwrite that changed nothing to no lines", () => {
    expect(editScopeOf({ type: "update", structuredPatch: [] })).toEqual(new Map());
  });
});

describe("inScope", () => {
  const scope = new Map([[4, "we should dig into it"]]);

  it("keeps an alert the edit introduced", () => {
    expect(inScope(alert(4, "deep dive"), scope)).toBe(true);
  });

  it("drops an alert on a line the edit left alone", () => {
    expect(inScope(alert(2, "dig into"), scope)).toBe(false);
  });

  it("drops an alert the replaced text already carried", () => {
    expect(inScope(alert(4, "dig into"), scope)).toBe(false);
  });
});
