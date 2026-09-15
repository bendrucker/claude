import { describe, expect, it } from "bun:test";
import { runLabel } from "./rework";

describe("runLabel", () => {
  it.each(["20260915-1200", "opus.v2", "arm_a"])("accepts %p", (label) => {
    expect(runLabel(label)).toBe(label);
  });

  it.each(["../results", "a/b", "..", ".", "", "label with space"])("refuses %p", (label) => {
    expect(() => runLabel(label)).toThrow(/single path segment/);
  });
});
