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

  test("coerces boolean attributes to actual booleans", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { completed: "true", canceled: "false" }));
    expect(result[0].attributes).toEqual({ completed: true, canceled: false });
  });

  test("leaves non-boolean attributes as strings", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { when: "today", completed: "true" }));
    expect(result[0].attributes).toEqual({ when: "today", completed: true });
  });

  test("coerces tags to string array", () => {
    const result = JSON.parse(buildJsonPayload(["ABC"], { tags: "work,personal" }));
    expect(result[0].attributes).toEqual({ tags: ["work", "personal"] });
  });

  test("coerces checklist-items to structured objects", () => {
    const result = JSON.parse(
      buildJsonPayload(["ABC"], { "checklist-items": "Buy milk\nWalk dog" }),
    );
    expect(result[0].attributes).toEqual({
      "checklist-items": [
        { type: "checklist-item", attributes: { title: "Buy milk" } },
        { type: "checklist-item", attributes: { title: "Walk dog" } },
      ],
    });
  });
});

describe("coerceAttributes", () => {
  test("coerces all known boolean attributes", () => {
    const result = coerceAttributes({
      completed: "true",
      canceled: "false",
      reveal: "true",
      duplicate: "false",
    });
    expect(result).toEqual({
      completed: true,
      canceled: false,
      reveal: true,
      duplicate: false,
    });
  });

  test("passes through string attributes unchanged", () => {
    const result = coerceAttributes({ when: "today" });
    expect(result).toEqual({ when: "today" });
  });

  test("does not coerce non-boolean values for boolean attributes", () => {
    const result = coerceAttributes({ completed: "yes" });
    expect(result).toEqual({ completed: "yes" });
  });

  test("coerces tags to string array", () => {
    const result = coerceAttributes({ tags: "tag1, tag2, tag3" });
    expect(result).toEqual({ tags: ["tag1", "tag2", "tag3"] });
  });

  test("coerces add-tags to string array", () => {
    const result = coerceAttributes({ "add-tags": "Urgent" });
    expect(result).toEqual({ "add-tags": ["Urgent"] });
  });

  test("coerces checklist-items to structured objects", () => {
    const result = coerceAttributes({ "checklist-items": "Item 1\nItem 2" });
    expect(result).toEqual({
      "checklist-items": [
        { type: "checklist-item", attributes: { title: "Item 1" } },
        { type: "checklist-item", attributes: { title: "Item 2" } },
      ],
    });
  });
});

describe("isSandboxBlockedHandoff", () => {
  test("matches procNotFound message", () => {
    expect(
      isSandboxBlockedHandoff(
        "LSOpenURLsWithRole() failed for the application /Applications/Things3.app with error -10810.\nprocNotFound: no eligible process with specified descriptor",
      ),
    ).toBe(true);
  });

  test("matches bare -10810 code", () => {
    expect(isSandboxBlockedHandoff("kLSApplicationNotFoundErr (-10810)")).toBe(true);
  });

  test("matches bare -10673 code", () => {
    expect(isSandboxBlockedHandoff("NSOSStatusErrorDomain error -10673")).toBe(true);
  });

  test("matches LSOpenURLsWithRole line on its own", () => {
    expect(isSandboxBlockedHandoff("LSOpenURLsWithRole failed")).toBe(true);
  });

  test("does not match unrelated stderr", () => {
    expect(isSandboxBlockedHandoff("some other error from open")).toBe(false);
  });

  test("does not match empty stderr", () => {
    expect(isSandboxBlockedHandoff("")).toBe(false);
  });

  test("does not match -10810 embedded in a larger number", () => {
    expect(isSandboxBlockedHandoff("some unrelated number 999-108100 here")).toBe(false);
    expect(isSandboxBlockedHandoff("error -108101 something else")).toBe(false);
  });

  test("does not match -10673 embedded in a larger number", () => {
    expect(isSandboxBlockedHandoff("some unrelated number 999-106730 here")).toBe(false);
    expect(isSandboxBlockedHandoff("error -106731 something else")).toBe(false);
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
