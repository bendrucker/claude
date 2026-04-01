import { describe, expect, it } from "bun:test";
import { currentPane } from "./tmux";

describe("currentPane", () => {
  it("returns TMUX_PANE when set", () => {
    const original = process.env.TMUX_PANE;
    process.env.TMUX_PANE = "%42";
    try {
      expect(currentPane()).toBe("%42");
    } finally {
      if (original) {
        process.env.TMUX_PANE = original;
      } else {
        delete process.env.TMUX_PANE;
      }
    }
  });
});
