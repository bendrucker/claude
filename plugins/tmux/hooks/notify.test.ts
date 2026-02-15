import { describe, expect, it } from "bun:test";
import { shouldNotify } from "./notify";

describe("shouldNotify", () => {
  it("returns true when TMUX is set", () => {
    expect(shouldNotify({ TMUX: "/tmp/tmux-501/default,12345,0" })).toBe(true);
  });

  it("returns false when TMUX is not set", () => {
    expect(shouldNotify({})).toBe(false);
  });

  it("returns false when TMUX is undefined", () => {
    expect(shouldNotify({ TMUX: undefined })).toBe(false);
  });
});
