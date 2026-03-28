import { describe, expect, it } from "bun:test";
import { sanitizeName } from "./tracking";

describe("sanitizeName", () => {
  it("passes through lowercase alphanumeric names", () => {
    expect(sanitizeName("my-pane")).toBe("my-pane");
  });

  it("lowercases uppercase characters", () => {
    expect(sanitizeName("MyPane")).toBe("mypane");
  });

  it("strips special characters", () => {
    expect(sanitizeName("my_pane!@#")).toBe("mypane");
  });

  it("preserves hyphens", () => {
    expect(sanitizeName("log-viewer-1")).toBe("log-viewer-1");
  });

  it("strips spaces", () => {
    expect(sanitizeName("my pane")).toBe("mypane");
  });

  it("returns empty string for all-special input", () => {
    expect(sanitizeName("!!!")).toBe("");
  });
});
