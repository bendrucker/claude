import { describe, expect, it } from "bun:test";
import { currentPane } from "./tmux";

describe("currentPane", () => {
  it("falls back to tmux query when TMUX_PANE is not set", () => {
    const original = process.env.TMUX_PANE;
    delete process.env.TMUX_PANE;
    try {
      const pane = currentPane();
      expect(pane).toMatch(/^%\d+$/);
    } finally {
      if (original) process.env.TMUX_PANE = original;
    }
  });
});
