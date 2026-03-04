import { describe, expect, it } from "bun:test";
import { validateScheme } from "./open-url";

describe("validateScheme", () => {
  it("accepts URL with correct scheme", () => {
    expect(validateScheme("things:///add?title=test", "things")).toEqual({ valid: true });
  });

  it("rejects URL with wrong scheme", () => {
    const result = validateScheme("https://example.com", "things");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("things://");
  });

  it("rejects URL missing scheme prefix", () => {
    const result = validateScheme("add?title=test", "things");
    expect(result.valid).toBe(false);
  });
});
