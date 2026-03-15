import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { join } from "node:path";

const tmuxFn = mock();
const tmuxQueryFn = mock();

mock.module("./tmux", () => ({
  tmux: tmuxFn,
  tmuxQuery: tmuxQueryFn,
}));

const { setup, teardown } = await import("./team-workaround");

const WRAPPER_PATH = join(import.meta.dirname, "shell-wrapper.sh");

describe("setup", () => {
  beforeEach(() => {
    process.env.TMUX = "/tmp/tmux-501/default,12345,0";
    process.env.PATH = "/usr/bin:/bin";
  });

  afterEach(() => {
    tmuxFn.mockReset();
    tmuxQueryFn.mockReset();
    delete process.env.TMUX;
  });

  it("saves current default-command and sets wrapper with window option", () => {
    tmuxQueryFn
      .mockReturnValueOnce(null) // sentinel check
      .mockReturnValueOnce("zsh"); // current default-command

    setup();

    expect(tmuxFn.mock.calls).toEqual([
      ["set-option", "@claude_original_default_command", "zsh"],
      ["set-option", "@claude_default_command_overridden", "1"],
      ["set-environment", "CLAUDE_PATH", "/usr/bin:/bin"],
      ["set-option", "default-command", WRAPPER_PATH],
      ["set-option", "-w", "@claude_fast_shell", "1"],
    ]);
  });

  it("skips saving when no existing default-command", () => {
    tmuxQueryFn
      .mockReturnValueOnce(null) // sentinel check
      .mockReturnValueOnce(null); // no current default-command

    setup();

    expect(tmuxFn.mock.calls).toEqual([
      ["set-option", "@claude_default_command_overridden", "1"],
      ["set-environment", "CLAUDE_PATH", "/usr/bin:/bin"],
      ["set-option", "default-command", WRAPPER_PATH],
      ["set-option", "-w", "@claude_fast_shell", "1"],
    ]);
  });

  it("skips when already overridden", () => {
    tmuxQueryFn.mockReturnValueOnce("1");

    setup();

    expect(tmuxFn).toHaveBeenCalledTimes(0);
  });
});

describe("teardown", () => {
  beforeEach(() => {
    process.env.TMUX = "/tmp/tmux-501/default,12345,0";
  });

  afterEach(() => {
    tmuxFn.mockReset();
    tmuxQueryFn.mockReset();
    delete process.env.TMUX;
  });

  it("restores saved default-command and cleans up", () => {
    tmuxQueryFn
      .mockReturnValueOnce("1") // sentinel check
      .mockReturnValueOnce("zsh"); // saved original

    teardown();

    expect(tmuxFn.mock.calls).toEqual([
      ["set-option", "default-command", "zsh"],
      ["set-option", "-u", "@claude_original_default_command"],
      ["set-option", "-u", "@claude_default_command_overridden"],
      ["set-option", "-wu", "@claude_fast_shell"],
      ["set-environment", "-r", "CLAUDE_PATH"],
    ]);
  });

  it("unsets default-command when no original was saved", () => {
    tmuxQueryFn
      .mockReturnValueOnce("1") // sentinel check
      .mockReturnValueOnce(null); // no saved original

    teardown();

    expect(tmuxFn.mock.calls[0]).toEqual(["set-option", "-u", "default-command"]);
  });

  it("skips when sentinel is not set", () => {
    tmuxQueryFn.mockReturnValueOnce(null);

    teardown();

    expect(tmuxFn).toHaveBeenCalledTimes(0);
  });
});
