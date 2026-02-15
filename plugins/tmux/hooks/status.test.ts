import { describe, expect, it } from "bun:test";
import { mapStopReason } from "./status";

describe("mapStopReason", () => {
  it("returns 'done' when stop hook is active", () => {
    expect(mapStopReason(true)).toBe("done");
  });

  it("returns 'idle' when stop hook is not active", () => {
    expect(mapStopReason(false)).toBe("idle");
  });
});
