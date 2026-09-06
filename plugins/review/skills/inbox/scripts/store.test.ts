import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDispatch,
  type Dispatch,
  type InboxState,
  isDispatched,
  readState,
  removeDispatch,
  writeState,
} from "./store";

function makeDispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    url: "https://github.com/owner/repo/pull/42",
    sessionId: "sess-1",
    dispatchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "store-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("readState", () => {
    test("returns empty dispatched when no file exists", async () => {
      expect(await readState(tmpDir)).toEqual({ dispatched: [] });
    });

    test("reads and parses valid state file", async () => {
      const state: InboxState = { dispatched: [makeDispatch()] };
      const dir = join(tmpDir, "review-inbox");
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "state.json"), JSON.stringify(state));

      expect(await readState(tmpDir)).toEqual(state);
    });

    test("throws on malformed JSON missing dispatched array", async () => {
      const dir = join(tmpDir, "review-inbox");
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "state.json"), JSON.stringify({ something: "else" }));

      expect(readState(tmpDir)).rejects.toThrow("Invalid state file");
    });

    test("keeps the parse failure as the cause when the file is not JSON", async () => {
      const dir = join(tmpDir, "review-inbox");
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "state.json"), "{ not json");

      const thrown = await readState(tmpDir).catch((error: unknown) => error);

      expect(thrown).toHaveProperty(
        "message",
        expect.stringContaining("Failed to parse state file"),
      );
      expect(thrown).toHaveProperty("cause", expect.any(SyntaxError));
    });

    test("migrates the pre-background { reviews } schema to an empty dedup set", async () => {
      const dir = join(tmpDir, "review-inbox");
      mkdirSync(dir, { recursive: true });
      await Bun.write(
        join(dir, "state.json"),
        JSON.stringify({ reviews: [{ url: "https://github.com/o/r/pull/1", paneId: "%1" }] }),
      );

      expect(await readState(tmpDir)).toEqual({ dispatched: [] });
    });
  });

  describe("writeState + readState round-trip", () => {
    test("write then read returns equal state", async () => {
      const state: InboxState = {
        dispatched: [
          makeDispatch(),
          makeDispatch({
            url: "https://gitlab.com/org/proj/-/merge_requests/7",
            sessionId: null,
          }),
        ],
      };

      await writeState(state, tmpDir);
      expect(await readState(tmpDir)).toEqual(state);
    });

    test("creates directory if it does not exist", async () => {
      const dir = join(tmpDir, "review-inbox");
      expect(readdir(dir)).rejects.toThrow();

      await writeState({ dispatched: [] }, tmpDir);

      expect(readdir(dir)).resolves.toBeDefined();
    });
  });

  describe("isDispatched", () => {
    test.each<[string, string, boolean]>([
      ["url present", "https://github.com/owner/repo/pull/42", true],
      ["url absent", "https://github.com/other/repo/pull/1", false],
    ])("%s", (_name, url, expected) => {
      const state: InboxState = { dispatched: [makeDispatch()] };
      expect(isDispatched(state, url)).toBe(expected);
    });
  });

  describe("addDispatch", () => {
    test("adds dispatch to state", () => {
      const state: InboxState = { dispatched: [] };
      const dispatch = makeDispatch();
      addDispatch(state, dispatch);

      expect(state.dispatched).toEqual([dispatch]);
    });

    test("throws on duplicate URL", () => {
      const state: InboxState = { dispatched: [makeDispatch()] };
      const duplicate = makeDispatch({ sessionId: "sess-other" });

      expect(() => addDispatch(state, duplicate)).toThrow("Review already dispatched");
    });
  });

  describe("removeDispatch", () => {
    test.each<[string, string, number, number]>([
      ["removes matching url", "https://github.com/owner/repo/pull/42", 1, 0],
      ["no match", "https://github.com/other/repo/pull/1", 0, 1],
    ])("%s", (_name, url, removed, remaining) => {
      const state: InboxState = { dispatched: [makeDispatch()] };
      expect(removeDispatch(state, url)).toBe(removed);
      expect(state.dispatched).toHaveLength(remaining);
    });
  });

  describe("no dataDir and no CLAUDE_PLUGIN_DATA", () => {
    const originalEnv = process.env.CLAUDE_PLUGIN_DATA;

    beforeEach(() => {
      delete process.env.CLAUDE_PLUGIN_DATA;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = originalEnv;
      }
    });

    test("readState throws", () => {
      expect(readState()).rejects.toThrow("dataDir is required");
    });

    test("writeState throws", () => {
      expect(writeState({ dispatched: [] })).rejects.toThrow("dataDir is required");
    });
  });

  describe("falls back to CLAUDE_PLUGIN_DATA", () => {
    const originalEnv = process.env.CLAUDE_PLUGIN_DATA;

    beforeEach(() => {
      process.env.CLAUDE_PLUGIN_DATA = tmpDir;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA;
      } else {
        process.env.CLAUDE_PLUGIN_DATA = originalEnv;
      }
    });

    test("readState uses CLAUDE_PLUGIN_DATA when no dataDir provided", async () => {
      expect(await readState()).toEqual({ dispatched: [] });
    });
  });
});
