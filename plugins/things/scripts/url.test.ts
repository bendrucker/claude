import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildJsonPayload,
  coerceAttributes,
  type DispatchActions,
  dispatch,
  findXcallRunner,
  isSandboxBlockedHandoff,
  resolveTagParams,
  XcallError,
  xcallBackstopMs,
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

describe("xcallBackstopMs", () => {
  test.each<{ name: string; env: Record<string, string | undefined> }>([
    { name: "defaults when neither bound is set", env: {} },
    { name: "a raised build bound", env: { XCALL_BUILD_TIMEOUT_SECONDS: "90" } },
    { name: "a raised callback bound", env: { XCALL_TIMEOUT_SECONDS: "60" } },
    {
      name: "both bounds raised",
      env: { XCALL_BUILD_TIMEOUT_SECONDS: "90", XCALL_TIMEOUT_SECONDS: "60" },
    },
    { name: "a non-numeric bound", env: { XCALL_TIMEOUT_SECONDS: "soon" } },
    { name: "a zero bound", env: { XCALL_TIMEOUT_SECONDS: "0" } },
  ])("outwaits run.sh with $name", ({ env }) => {
    const bound = (name: string) => Number(env[name]) || 20;
    // run.sh waits out a lock holder's whole turn before starting its own, so
    // the callback bound counts once for the wait and once for the call.
    const callback = bound("XCALL_TIMEOUT_SECONDS");
    const runnerCeilingMs =
      (bound("XCALL_BUILD_TIMEOUT_SECONDS") + (callback + 2 + 1) + callback + 2) * 1000;

    expect(xcallBackstopMs(env)).toBeGreaterThan(runnerCeilingMs);
  });

  test("reports the derived values", () => {
    expect({
      defaults: xcallBackstopMs({}),
      raised: xcallBackstopMs({ XCALL_BUILD_TIMEOUT_SECONDS: "90", XCALL_TIMEOUT_SECONDS: "60" }),
    }).toMatchInlineSnapshot(`
      {
        "defaults": 80000,
        "raised": 230000,
      }
    `);
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

    expect(result).toEqual({
      id: "ABC123",
      output: expect.any(String),
      viaXcall: true,
      fallbackReason: null,
      fallbackDetail: null,
    });
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

    expect(result).toEqual({
      id: null,
      output: null,
      viaXcall: false,
      fallbackReason: "the x-callback-url runner was not found",
      fallbackDetail: null,
    });
    expect(calls.xcall).toEqual([]);
    expect(calls.open).toEqual(["add"]);
  });

  test.each<[string, Error, string, string | null]>([
    [
      "build failure",
      new XcallError(3, "swiftc: error: Operation not permitted\n"),
      "the x-callback-url bridge failed to build",
      "swiftc: error: Operation not permitted",
    ],
    [
      "callback timeout",
      new XcallError(4, "xcall gave up after 20s\n"),
      "the x-callback-url bridge timed out waiting for Things to call back",
      "xcall gave up after 20s",
    ],
    ["app error", new XcallError(1, ""), "xcall exited 1", null],
    ["non-xcall error", new Error("spawn blew up"), "spawn blew up", null],
  ])("falls back to openUrl and reports a %s", async (_name, thrown, reason, detail) => {
    const { actions, calls } = trackingActions({
      xcall: async () => {
        throw thrown;
      },
    });

    const result = await dispatch("add", new Map([["title", "Buy milk"]]), actions);

    expect(result.viaXcall).toBe(false);
    expect(result.fallbackReason).toBe(reason);
    expect(result.fallbackDetail).toBe(detail);
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

describe("findXcallRunner", () => {
  test("names the x-callback-url plugin's run.sh", async () => {
    const root = mkdtempSync(join(tmpdir(), "things-marketplace-"));
    await Bun.write(join(root, "x-callback-url/scripts/run.sh"), "");
    expect(await findXcallRunner(join(root, "things"))).toBe(
      join(root, "x-callback-url", "scripts", "run.sh"),
    );
  });

  test("finds nothing when the plugin is absent", async () => {
    const root = mkdtempSync(join(tmpdir(), "things-marketplace-"));
    expect(await findXcallRunner(join(root, "things"))).toBeNull();
  });
});

describe("resolveTagParams", () => {
  /** Stands in for the real requirer, recording what each write asked for. */
  function stubRequirer(known: string[]) {
    const calls: Array<{ requested: string[]; createMissing: boolean }> = [];
    const requirer = (requested: string[], createMissing: boolean) => {
      calls.push({ requested, createMissing });
      const unknown = requested.filter((tag) => !known.includes(tag.toLowerCase()));
      if (unknown.length > 0 && !createMissing) {
        return Promise.reject(new Error(`Tag not found: ${unknown.join(", ")}`));
      }
      return Promise.resolve(requested.map((tag) => tag.toLowerCase()));
    };
    return { calls, requirer };
  }

  test("rewrites tag params to the casing Things stores", async () => {
    const { requirer } = stubRequirer(["claude", "bug"]);
    const params = new Map([
      ["title", "Fix it"],
      ["tags", "Claude, BUG"],
    ]);

    await resolveTagParams(params, false, requirer);
    expect(params.get("tags")).toBe("claude,bug");
    expect(params.get("title")).toBe("Fix it");
  });

  test("resolves add-tags alongside tags", async () => {
    const { calls, requirer } = stubRequirer(["claude", "bug"]);
    const params = new Map([
      ["tags", "Claude"],
      ["add-tags", "BUG"],
    ]);

    await resolveTagParams(params, false, requirer);
    expect(params.get("tags")).toBe("claude");
    expect(params.get("add-tags")).toBe("bug");
    expect(calls).toEqual([
      { requested: ["Claude"], createMissing: false },
      { requested: ["BUG"], createMissing: false },
    ]);
  });

  // The silent drop this guards: Things takes an unknown tag, reports success,
  // and writes the todo without it.
  test("rejects an unknown tag instead of dropping it", async () => {
    const { requirer } = stubRequirer(["claude"]);
    const params = new Map([["tags", "claude,bug"]]);

    await expect(resolveTagParams(params, false, requirer)).rejects.toThrow("Tag not found: bug");
  });

  test("passes create_tags through so an unknown tag can be created", async () => {
    const { calls, requirer } = stubRequirer(["claude"]);
    const params = new Map([["tags", "claude,bug"]]);

    await resolveTagParams(params, true, requirer);
    expect(params.get("tags")).toBe("claude,bug");
    expect(calls).toEqual([{ requested: ["claude", "bug"], createMissing: true }]);
  });

  test.each([
    ["a write carrying no tag params", [["title", "Buy milk"]]],
    ["an empty tags= that clears the todo's tags", [["tags", ""]]],
  ] as Array<[string, Array<[string, string]>]>)("never fetches for %s", async (_, entries) => {
    const { calls, requirer } = stubRequirer(["claude"]);
    const params = new Map(entries);
    const before = new Map(params);

    await resolveTagParams(params, false, requirer);
    expect(calls).toEqual([]);
    expect(params).toEqual(before);
  });
});
