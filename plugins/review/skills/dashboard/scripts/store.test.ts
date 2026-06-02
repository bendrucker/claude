import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addReview,
  completeReview,
  createReview,
  type DashboardState,
  type Review,
  readState,
  removeReview,
  writeState,
} from "./store";

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    url: "https://github.com/owner/repo/pull/42",
    title: "Fix bug",
    repo: "owner/repo",
    sessionId: "sess-1",
    paneId: "%1",
    paneName: "review-owner-repo-42",
    repoPath: "/tmp/repo",
    status: "active",
    startedAt: new Date().toISOString(),
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
    test("returns empty reviews when no file exists", async () => {
      expect(await readState(tmpDir)).toEqual({ reviews: [] });
    });

    test("reads and parses valid state file", async () => {
      const state: DashboardState = { reviews: [makeReview()] };
      const dir = join(tmpDir, "review-dashboard");
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "state.json"), JSON.stringify(state));

      expect(await readState(tmpDir)).toEqual(state);
    });

    test("throws on malformed JSON missing reviews array", async () => {
      const dir = join(tmpDir, "review-dashboard");
      mkdirSync(dir, { recursive: true });
      await Bun.write(join(dir, "state.json"), JSON.stringify({ something: "else" }));

      expect(readState(tmpDir)).rejects.toThrow("Invalid state file");
    });
  });

  describe("writeState + readState round-trip", () => {
    test("write then read returns equal state", async () => {
      const state: DashboardState = {
        reviews: [
          makeReview(),
          makeReview({
            url: "https://gitlab.com/org/proj/-/merge_requests/7",
            repo: "org/proj",
            paneName: "review-org-proj-7",
          }),
        ],
      };

      await writeState(state, tmpDir);
      expect(await readState(tmpDir)).toEqual(state);
    });
  });

  describe("writeState", () => {
    test("creates directory if it does not exist", async () => {
      const dir = join(tmpDir, "review-dashboard");
      await expect(readdir(dir)).rejects.toThrow();

      await writeState({ reviews: [] }, tmpDir);

      await expect(readdir(dir)).resolves.toBeDefined();
    });
  });

  describe("createReview", () => {
    test("derives repo and paneName from URL", () => {
      const review = createReview({
        url: "https://github.com/acme/widgets/pull/99",
        title: "Add feature",
        sessionId: "sess-abc",
        paneId: "%5",
        repoPath: "/code/widgets",
      });

      expect(review.repo).toBe("acme/widgets");
      expect(review.paneName).toBe("review-acme-widgets-99");
    });

    test("sets status to active and startedAt", () => {
      const before = new Date();
      const review = createReview({
        url: "https://github.com/acme/widgets/pull/99",
        title: null,
        sessionId: "sess-abc",
        paneId: "%5",
        repoPath: "/code/widgets",
      });

      expect(review.status).toBe("active");
      const startedAt = new Date(review.startedAt);
      expect(startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("addReview", () => {
    test("adds review to state", () => {
      const state: DashboardState = { reviews: [] };
      const review = makeReview();
      addReview(state, review);

      expect(state.reviews).toEqual([review]);
    });

    test("throws on duplicate URL", () => {
      const state: DashboardState = { reviews: [makeReview()] };
      const duplicate = makeReview();

      expect(() => addReview(state, duplicate)).toThrow("Review already tracked");
    });
  });

  describe("removeReview", () => {
    test("removes matching review and returns count", () => {
      const state: DashboardState = { reviews: [makeReview()] };
      const removed = removeReview(state, "https://github.com/owner/repo/pull/42");

      expect(removed).toBe(1);
      expect(state.reviews).toEqual([]);
    });

    test("returns 0 when URL not found", () => {
      const state: DashboardState = { reviews: [makeReview()] };
      const removed = removeReview(state, "https://github.com/other/repo/pull/1");

      expect(removed).toBe(0);
      expect(state.reviews).toHaveLength(1);
    });
  });

  describe("completeReview", () => {
    test("marks active review as completed", () => {
      const state: DashboardState = { reviews: [makeReview({ paneId: "%3" })] };
      const result = completeReview(state, "%3");

      expect(result).toBe(true);
      expect(state.reviews[0]?.status).toBe("completed");
    });

    test("returns false when pane not found", () => {
      const state: DashboardState = { reviews: [makeReview()] };
      expect(completeReview(state, "%99")).toBe(false);
    });

    test("skips already completed reviews", () => {
      const state: DashboardState = {
        reviews: [makeReview({ paneId: "%3", status: "completed" })],
      };
      expect(completeReview(state, "%3")).toBe(false);
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
      expect(writeState({ reviews: [] })).rejects.toThrow("dataDir is required");
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
      expect(await readState()).toEqual({ reviews: [] });
    });
  });
});
