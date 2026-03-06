import { describe, expect, it } from "bun:test";
import { validateAppScope } from "./jxa";

describe("validateAppScope", () => {
  it("allows Application matching the target app", () => {
    const result = validateAppScope('Application("Things3").lists()', "Things3");
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("rejects Application targeting a different app", () => {
    const result = validateAppScope('Application("Mail").inbox()', "Things3");
    expect(result).toEqual({ valid: false, violations: ["Mail"] });
  });

  it("allows Application.currentApplication()", () => {
    const result = validateAppScope(
      "var app = Application.currentApplication(); app.includeStandardAdditions = true;",
      "Things3",
    );
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("detects mixed target and foreign apps", () => {
    const result = validateAppScope(
      'Application("Things3").name(); Application("Mail").inbox()',
      "Things3",
    );
    expect(result).toEqual({ valid: false, violations: ["Mail"] });
  });

  it("ignores Application in comments", () => {
    const source = [
      "// Application('Mail')",
      'var app = Application("Things3");',
      "app.name();",
    ].join("\n");
    const result = validateAppScope(source, "Things3");
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("ignores Application in string literals", () => {
    const source = 'var s = "Application(\'Mail\')"; Application("Things3").name();';
    const result = validateAppScope(source, "Things3");
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("strips shebang before parsing", () => {
    const source =
      '#!/usr/bin/env osascript -l JavaScript\nfunction run() { Application("Things3").name(); }';
    const result = validateAppScope(source, "Things3");
    expect(result).toEqual({ valid: true, violations: [] });
  });

  it("throws on syntax errors", () => {
    expect(() => validateAppScope("function {{{", "Things3")).toThrow("Failed to parse JXA source");
  });

  it("allows scripts with no Application calls", () => {
    const result = validateAppScope("var x = 1 + 2;", "Things3");
    expect(result).toEqual({ valid: true, violations: [] });
  });
});
