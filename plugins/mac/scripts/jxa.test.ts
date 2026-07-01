import { describe, expect, it } from "bun:test";
import { isTransientAppleEventsError, runWithRetry, validateAppScope } from "./jxa";
import type { RunResult } from "./jxa";

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

describe("isTransientAppleEventsError", () => {
  it("matches the -10004 privilege-violation code in stderr", () => {
    expect(isTransientAppleEventsError(1, "execution error: not allowed (-10004)")).toBe(true);
  });

  it("matches the -600 code in stderr", () => {
    expect(isTransientAppleEventsError(1, "execution error: isn't running (-600)")).toBe(true);
  });

  it("matches a Connection Invalid XPC hiccup", () => {
    expect(
      isTransientAppleEventsError(1, "Connection Invalid to com.apple.hiservices-xpcservice"),
    ).toBe(true);
  });

  it("matches when the transient code surfaces as the exit code", () => {
    expect(isTransientAppleEventsError(-10004, "")).toBe(true);
    expect(isTransientAppleEventsError(-600, "")).toBe(true);
  });

  it("does not match an unrelated execution error", () => {
    expect(isTransientAppleEventsError(1, "execution error: Can't get item 5 (-1728)")).toBe(false);
  });

  it("does not match success", () => {
    expect(isTransientAppleEventsError(0, "")).toBe(false);
  });
});

describe("runWithRetry", () => {
  const noSleep = () => Promise.resolve();

  function runner(results: RunResult[]) {
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      const next = results.shift();
      if (!next) throw new Error("runner called more times than expected");
      return Promise.resolve(next);
    };
    return { run, calls };
  }

  it("retries once on a transient error then succeeds", async () => {
    const { run, calls } = runner([
      { code: 1, stdout: "", stderr: "execution error (-10004)" },
      { code: 0, stdout: "ok", stderr: "" },
    ]);
    const result = await runWithRetry(["-e", "x"], run, noSleep);
    expect(result).toEqual({ code: 0, stdout: "ok", stderr: "" });
    expect(calls).toHaveLength(2);
  });

  it("retries once then surfaces the real error", async () => {
    const persistent: RunResult = { code: 1, stdout: "", stderr: "Connection Invalid" };
    const { run, calls } = runner([persistent, { ...persistent }]);
    const result = await runWithRetry(["-e", "x"], run, noSleep);
    expect(result).toEqual(persistent);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a non-transient failure", async () => {
    const { run, calls } = runner([{ code: 1, stdout: "", stderr: "syntax error (-2740)" }]);
    const result = await runWithRetry(["-e", "x"], run, noSleep);
    expect(result).toEqual({ code: 1, stdout: "", stderr: "syntax error (-2740)" });
    expect(calls).toHaveLength(1);
  });

  it("does not retry on success", async () => {
    const { run, calls } = runner([{ code: 0, stdout: "2", stderr: "" }]);
    const result = await runWithRetry(["-e", "1 + 1"], run, noSleep);
    expect(result).toEqual({ code: 0, stdout: "2", stderr: "" });
    expect(calls).toHaveLength(1);
  });
});
