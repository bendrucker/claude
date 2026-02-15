import { describe, expect, it } from "bun:test";
import { formatEnvContent } from "./context";

describe("formatEnvContent", () => {
  it("formats session, window, and pane as env lines", () => {
    const result = formatEnvContent("main", "0", "1");
    expect(result).toBe("CLAUDE_TMUX_SESSION=main\nCLAUDE_TMUX_WINDOW=0\nCLAUDE_TMUX_PANE=1\n");
  });

  it("handles session names with special characters", () => {
    const result = formatEnvContent("my-project", "2", "0");
    expect(result).toContain("CLAUDE_TMUX_SESSION=my-project");
    expect(result).toContain("CLAUDE_TMUX_WINDOW=2");
    expect(result).toContain("CLAUDE_TMUX_PANE=0");
    expect(result).toEndWith("\n");
  });
});
