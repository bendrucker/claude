import { describe, expect, it } from "bun:test";
import { buildExports, buildFormat } from "./context";

describe("buildFormat", () => {
  it("joins tmux format strings with delimiter", () => {
    const format = buildFormat();
    expect(format).toContain("#{session_name}");
    expect(format).toContain("#{pane_id}");
    expect(format.split("\x1f")).toHaveLength(5);
  });
});

describe("buildExports", () => {
  it("generates export statements from tmux output", () => {
    const output = `main\x1f0\x1fvim\x1f1\x1f%3\n`;
    const result = buildExports(output);
    expect(result).toBe(
      [
        "export TMUX_SESSION_NAME='main'",
        "export TMUX_WINDOW_INDEX='0'",
        "export TMUX_WINDOW_NAME='vim'",
        "export TMUX_PANE_INDEX='1'",
        "export TMUX_PANE_ID='%3'",
        "",
      ].join("\n"),
    );
  });

  it("handles single quotes in values", () => {
    const output = `it's\x1f0\x1fdon't\x1f1\x1f%0\n`;
    const result = buildExports(output);
    expect(result).toContain("export TMUX_SESSION_NAME='it'\\''s'");
    expect(result).toContain("export TMUX_WINDOW_NAME='don'\\''t'");
  });

  it("handles empty values", () => {
    const output = `\x1f\x1f\x1f\x1f\n`;
    const result = buildExports(output);
    expect(result).toContain("export TMUX_SESSION_NAME=''");
  });
});
