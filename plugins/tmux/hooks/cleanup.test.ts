import { describe, expect, it } from "bun:test";
import { paneVariables } from "./cleanup";

describe("paneVariables", () => {
  it("includes @claude_status", () => {
    expect(paneVariables).toContain("@claude_status");
  });
});
