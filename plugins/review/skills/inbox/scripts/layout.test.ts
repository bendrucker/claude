import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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

  test.each<[number, string | undefined, string | undefined, string[]]>([
    [0, undefined, undefined, ["-h", "-d", "-l", "70%", "-t", "%0"]],
    [1, "%1", undefined, ["-v", "-d", "-t", "%1"]],
    [2, "%2", undefined, ["-v", "-d", "-t", "%2"]],
    [3, "%3", undefined, ["-h", "-d", "-t", "%3"]],
    [0, undefined, "reviews", ["-h", "-d", "-t", "reviews"]],
    [1, "%1", "reviews", ["-v", "-d", "-t", "%1"]],
  ])("index=%p lastPane=%p target=%p", (index, lastPane, target, expected) => {
    expect(layoutArgs(index, lastPane, target)).toEqual(expected);
  });

  test("throws when TMUX_PANE is not set", () => {
    delete process.env.TMUX_PANE;
    expect(() => layoutArgs(0, undefined)).toThrow(
      "TMUX_PANE is not set (not running inside tmux)",
    );
  });

  test("target session does not require TMUX_PANE for the first pane", () => {
    delete process.env.TMUX_PANE;
    expect(layoutArgs(0, undefined, "reviews")).toEqual(["-h", "-d", "-t", "reviews"]);
  });
});
