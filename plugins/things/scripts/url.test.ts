import { describe, expect, test } from "bun:test";
import {
  buildJsonPayload,
  coerceAttributes,
  type DispatchActions,
  dispatch,
  isSandboxBlockedHandoff,
} from "./url";

describe("buildJsonPayload", () => {
  test("single ID produces correct structure", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { when: "tomorrow" }));
    expect(result).toEqual([
      {
        type: "to-do",
        operation: "update",
        id: "ABC",
        attributes: { when: "tomorrow" },
      },
    ]);
  });

  test("multiple IDs produce one object per ID with same attributes", () => {
    const result = JSON.parse(
      buildJsonPayload(["A", "B", "C"], { when: "today", "add-tags": "Urgent" }),
    );
    const expected = {
      type: "to-do",
      operation: "update",
      attributes: { when: "today", "add-tags": ["Urgent"] },
    };
    expect(result).toEqual([
      { ...expected, id: "A" },
      { ...expected, id: "B" },
      { ...expected, id: "C" },
    ]);
  });

  test("empty ID list throws", () => {
    expect(() => buildJsonPayload([], { when: "today" })).toThrow("At least one ID is required");
  });

  test("empty attributes throws", () => {
    expect(() => buildJsonPayload(["ABC"], {})).toThrow("At least one attribute is required");
  });

  test.each<[string, Record<string, string>, Record<string, unknown>]>([
    [
      "coerces boolean attributes to actual booleans",
      { completed: "true", canceled: "false" },
      { completed: true, canceled: false },
    ],
    [
      "leaves non-boolean attributes as strings",
      { when: "today", completed: "true" },
      { when: "today", completed: true },
    ],
    ["coerces tags to string array", { tags: "work,personal" }, { tags: ["work", "personal"] }],
    [
      "coerces checklist-items to structured objects",
      { "checklist-items": "Buy milk\nWalk dog" },
      {
        "checklist-items": [
          { type: "checklist-item", attributes: { title: "Buy milk" } },
          { type: "checklist-item", attributes: { title: "Walk dog" } },
        ],
      },
    ],
  ])("%s", (_name, attrs, expected) => {
    const result = JSON.parse(buildJsonPayload(["ABC"], attrs));
    expect(result[0].attributes).toEqual(expected);
  });
});

describe("coerceAttributes", () => {
  test.each<[string, Record<string, string>, ReturnType<typeof coerceAttributes>]>([
    [
      "coerces all known boolean attributes",
      { completed: "true", canceled: "false", reveal: "true", duplicate: "false" },
      { completed: true, canceled: false, reveal: true, duplicate: false },
    ],
    ["passes through string attributes unchanged", { when: "today" }, { when: "today" }],
    [
      "does not coerce non-boolean values for boolean attributes",
      { completed: "yes" },
      { completed: "yes" },
    ],
    [
      "coerces tags to string array",
      { tags: "tag1, tag2, tag3" },
      { tags: ["tag1", "tag2", "tag3"] },
    ],
    ["coerces add-tags to string array", { "add-tags": "Urgent" }, { "add-tags": ["Urgent"] }],
    [
      "coerces checklist-items to structured objects",
      { "checklist-items": "Item 1\nItem 2" },
      {
        "checklist-items": [
          { type: "checklist-item", attributes: { title: "Item 1" } },
          { type: "checklist-item", attributes: { title: "Item 2" } },
        ],
      },
    ],
  ])("%s", (_name, attrs, expected) => {
    expect(coerceAttributes(attrs)).toEqual(expected);
  });
});

describe("isSandboxBlockedHandoff", () => {
  test.each<[string, string, boolean]>([
    [
      "matches procNotFound message",
      "LSOpenURLsWithRole() failed for the application /Applications/Things3.app with error -10810.\nprocNotFound: no eligible process with specified descriptor",
      true,
    ],
    ["matches bare -10810 code", "kLSApplicationNotFoundErr (-10810)", true],
    ["matches bare -10673 code", "NSOSStatusErrorDomain error -10673", true],
    ["matches LSOpenURLsWithRole line on its own", "LSOpenURLsWithRole failed", true],
    ["does not match unrelated stderr", "some other error from open", false],
    ["does not match empty stderr", "", false],
    [
      "does not match -10810 embedded in a larger number (leading digit)",
      "some unrelated number 999-108100 here",
      false,
    ],
    [
      "does not match -10810 embedded in a larger number (trailing digit)",
      "error -108101 something else",
      false,
    ],
    [
      "does not match -10673 embedded in a larger number (leading digit)",
      "some unrelated number 999-106730 here",
      false,
    ],
    [
      "does not match -10673 embedded in a larger number (trailing digit)",
      "error -106731 something else",
      false,
    ],
  ])("%s", (_name, stderr, expected) => {
    expect(isSandboxBlockedHandoff(stderr)).toBe(expected);
  });
});

describe("dispatch", () => {
  function trackingActions(overrides: Partial<DispatchActions>): {
    actions: DispatchActions;
    calls: { xcall: string[]; open: string[] };
  } {
    const calls = { xcall: [] as string[], open: [] as string[] };
    const actions: DispatchActions = {
      findXcallRunner: async () => "/runner",
      xcall: async (_runner, url) => {
        calls.xcall.push(url);
        return "";
      },
      openUrl: async (command) => {
        calls.open.push(command);
      },
      ...overrides,
    };
    return { actions, calls };
  }

  test("runs via xcall and parses the returned id", async () => {
    const { actions, calls } = trackingActions({
      xcall: async (_runner, url) => {
        calls.xcall.push(url);
        return "things:///x-callback-url/add?x-things-id=ABC123&x-source=Things";
      },
    });

    const result = await dispatch("add", new Map([["title", "Buy milk"]]), actions);

    expect(result).toEqual({ id: "ABC123", output: expect.any(String), viaXcall: true });
    expect(calls.open).toEqual([]);
    expect(calls.xcall[0]).toContain("things:///add?");
  });

  test("returns a null id when xcall surfaces no id", async () => {
    const { actions } = trackingActions({ xcall: async () => "" });

    const result = await dispatch("add", new Map([["title", "Buy milk"]]), actions);

    expect(result.id).toBeNull();
    expect(result.viaXcall).toBe(true);
  });

  test("falls back to openUrl when no runner is available", async () => {
    const { actions, calls } = trackingActions({ findXcallRunner: async () => null });

    const result = await dispatch("add", new Map([["title", "Buy milk"]]), actions);

    expect(result).toEqual({ id: null, output: null, viaXcall: false });
    expect(calls.xcall).toEqual([]);
    expect(calls.open).toEqual(["add"]);
  });

  test("falls back to openUrl when xcall throws", async () => {
    const { actions, calls } = trackingActions({
      xcall: async () => {
        throw new Error("xcall failed (exit 1)");
      },
    });

    const result = await dispatch("add", new Map([["title", "Buy milk"]]), actions);

    expect(result.viaXcall).toBe(false);
    expect(calls.open).toEqual(["add"]);
  });

  test("propagates openUrl errors", async () => {
    const { actions } = trackingActions({
      findXcallRunner: async () => null,
      openUrl: async () => {
        throw new Error("open blocked");
      },
    });

    await expect(dispatch("add", new Map([["title", "Buy milk"]]), actions)).rejects.toThrow(
      "open blocked",
    );
  });
});
