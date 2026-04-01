import { describe, expect, it } from "bun:test";
import { currentPane } from "./tmux";

describe("currentPane", () => {
  it("falls back to tmux query when TMUX_PANE is not set", () => {
    const original = process.env.TMUX_PANE;
    delete process.env.TMUX_PANE;
    try {
      try {
        const pane = currentPane();
        expect(pane).toMatch(/^%\d+$/);
      } catch (e) {
        expect((e as Error).message).toBe(
          "Could not determine pane ID from TMUX_PANE or tmux query",
        );
      }
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
