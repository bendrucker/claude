import { describe, expect, spyOn, test } from "bun:test";
import { printCaptured } from "./inbox";

describe("printCaptured", () => {
  test("prints title when present", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(new Map([["title", "Buy milk"]]));
      expect(log).toHaveBeenCalledWith("captured: Buy milk");
    } finally {
      log.mockRestore();
    }
  });

  test("prints first line and count for multi-line titles", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(new Map([["titles", "Buy milk\nWalk dog\nCall mom"]]));
      expect(log).toHaveBeenCalledWith("captured: Buy milk (+2 more)");
    } finally {
      log.mockRestore();
    }
  });

  test("prints titles without suffix when only one line", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(new Map([["titles", "Just one"]]));
      expect(log).toHaveBeenCalledWith("captured: Just one");
    } finally {
      log.mockRestore();
    }
  });

  test("ignores blank lines in titles count", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(new Map([["titles", "Buy milk\n\n  \nWalk dog"]]));
      expect(log).toHaveBeenCalledWith("captured: Buy milk (+1 more)");
    } finally {
      log.mockRestore();
    }
  });

  test("falls back to (untitled) when neither title nor titles present", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(new Map([["notes", "just notes"]]));
      expect(log).toHaveBeenCalledWith("captured: (untitled)");
    } finally {
      log.mockRestore();
    }
  });

  test("prefers title over titles when both present", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      printCaptured(
        new Map([
          ["title", "Primary"],
          ["titles", "Secondary"],
        ]),
      );
      expect(log).toHaveBeenCalledWith("captured: Primary");
    } finally {
      log.mockRestore();
    }
  });
});
