import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readState,
  writeState,
  createReview,
  addReview,
  type DashboardState,
  type Review,
} from "./store";

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    url: "https://github.com/owner/repo/pull/42",
    title: "Fix bug",
    repo: "owner/repo",
    platform: "github",
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
  const originalEnv = process.env.CLAUDE_PLUGIN_DATA;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "store-test-"));
    process.env.CLAUDE_PLUGIN_DATA = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = originalEnv;
    }
  });

  describe("readState", () => {
    test("returns empty reviews when no file exists", () => {
      expect(readState()).toEqual({ reviews: [] });
    });

    test("reads and parses valid state file", () => {
      const state: DashboardState = { reviews: [makeReview()] };
      const dir = join(tmpDir, "review-dashboard");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify(state));

      expect(readState()).toEqual(state);
    });

    test("throws on malformed JSON missing reviews array", () => {
      const dir = join(tmpDir, "review-dashboard");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.json"), JSON.stringify({ something: "else" }));

      expect(() => readState()).toThrow("Invalid state file");
    });
  });

  describe("writeState + readState round-trip", () => {
    test("write then read returns equal state", () => {
      const state: DashboardState = {
        reviews: [
          makeReview(),
          makeReview({
            url: "https://gitlab.com/org/proj/-/merge_requests/7",
            repo: "org/proj",
            platform: "gitlab",
            paneName: "review-org-proj-7",
          }),
        ],
      };

      writeState(state);
      expect(readState()).toEqual(state);
    });
  });

  describe("writeState", () => {
    test("creates directory if it does not exist", () => {
      const dir = join(tmpDir, "review-dashboard");
      expect(existsSync(dir)).toBe(false);

      writeState({ reviews: [] });

      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("createReview", () => {
    test("derives platform, repo, paneName from URL", () => {
      const review = createReview({
        url: "https://github.com/acme/widgets/pull/99",
        title: "Add feature",
        sessionId: "sess-abc",
        paneId: "%5",
        repoPath: "/code/widgets",
      });

      expect(review.platform).toBe("github");
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

  describe("CLAUDE_PLUGIN_DATA unset", () => {
    test("readState throws", () => {
      delete process.env.CLAUDE_PLUGIN_DATA;
      expect(() => readState()).toThrow("CLAUDE_PLUGIN_DATA is not set");
    });

    test("writeState throws", () => {
      delete process.env.CLAUDE_PLUGIN_DATA;
      expect(() => writeState({ reviews: [] })).toThrow("CLAUDE_PLUGIN_DATA is not set");
    });
  });
});
