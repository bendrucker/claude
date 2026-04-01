import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { layoutArgs } from "./layout";

describe("layoutArgs", () => {
  let originalPane: string | undefined;

  beforeEach(() => {
    originalPane = process.env.TMUX_PANE;
    process.env.TMUX_PANE = "%0";
  });

  afterEach(() => {
    if (originalPane === undefined) {
      delete process.env.TMUX_PANE;
    } else {
      process.env.TMUX_PANE = originalPane;
    }
  });

  test("first pane: horizontal split at 70% against orchestrator", () => {
    expect(layoutArgs(0, undefined)).toEqual(["-h", "-d", "-l", "70%", "-t", "%0"]);
  });

  test("second pane: vertical split against last pane", () => {
    expect(layoutArgs(1, "%1")).toEqual(["-v", "-d", "-t", "%1"]);
  });

  test("third pane: vertical split against last pane", () => {
    expect(layoutArgs(2, "%2")).toEqual(["-v", "-d", "-t", "%2"]);
  });

  test("fourth pane: new horizontal split column", () => {
    expect(layoutArgs(3, "%3")).toEqual(["-h", "-d", "-t", "%3"]);
  });

  test("throws when TMUX_PANE is not set", () => {
    delete process.env.TMUX_PANE;
    expect(() => layoutArgs(0, undefined)).toThrow(
      "TMUX_PANE is not set (not running inside tmux)",
    );
  });
});
