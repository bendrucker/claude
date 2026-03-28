import { describe, expect, it } from "bun:test";
import { currentPane } from "./tmux";

describe("currentPane", () => {
  it("throws when TMUX_PANE is not set", () => {
    const original = process.env.TMUX_PANE;
    delete process.env.TMUX_PANE;
    try {
      expect(() => currentPane()).toThrow("TMUX_PANE is not set");
    } finally {
      if (original) process.env.TMUX_PANE = original;
    }
  });

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
