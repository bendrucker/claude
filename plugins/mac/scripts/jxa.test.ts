import { describe, expect, it, test } from "bun:test";
import { join } from "node:path";
import type { RunResult } from "./jxa";
import { isRetriableAppleEventsError, parseArgv, runWithRetry, validateAppScope } from "./jxa";

type ScopeResult = { valid: boolean; violations: string[] };
const valid: ScopeResult = { valid: true, violations: [] };
const commentedOutSource = [
  "// Application('Mail')",
  'var app = Application("Things3");',
  "app.name();",
].join("\n");

describe("validateAppScope", () => {
  test.each<{ name: string; source: string; expected: ScopeResult }>([
    {
      name: "allows Application matching the target app",
      source: 'Application("Things3").lists()',
      expected: valid,
    },
    {
      name: "rejects Application targeting a different app",
      source: 'Application("Mail").inbox()',
      expected: { valid: false, violations: ["Mail"] },
    },
    {
      name: "allows Application.currentApplication()",
      source: "var app = Application.currentApplication(); app.includeStandardAdditions = true;",
      expected: valid,
    },
    {
      name: "detects mixed target and foreign apps",
      source: 'Application("Things3").name(); Application("Mail").inbox()',
      expected: { valid: false, violations: ["Mail"] },
    },
    { name: "ignores Application in comments", source: commentedOutSource, expected: valid },
    {
      name: "ignores Application in string literals",
      source: 'var s = "Application(\'Mail\')"; Application("Things3").name();',
      expected: valid,
    },
    {
      name: "strips shebang before parsing",
      source:
        '#!/usr/bin/env osascript -l JavaScript\nfunction run() { Application("Things3").name(); }',
      expected: valid,
    },
    { name: "allows scripts with no Application calls", source: "var x = 1 + 2;", expected: valid },
  ])("$name", ({ source, expected }) => {
    expect(validateAppScope(source, "Things3")).toEqual(expected);
  });

  it("throws on syntax errors", () => {
    expect(() => validateAppScope("function {{{", "Things3")).toThrow("Failed to parse JXA source");
  });
});

describe("parseArgv", () => {
  // Regression: cleye consumed unrecognized flags as its own, so a flag meant
  // for the target script never reached osascript and the script saw a short
  // argument list.
  it("forwards every post-script argument to the script", () => {
    const invocations: Record<string, string[]> = {
      "documented logbook query": [
        "Things3",
        "query-logbook.js",
        "2026-06-01T00:00:00Z",
        "2026-08-15T00:00:00Z",
        "--notes-contains",
        "Discovery:",
      ],
      "explicit -- separator": [
        "Things3",
        "query-logbook.js",
        "2026-06-01T00:00:00Z",
        "--",
        "--notes-contains",
        "Discovery:",
      ],
      // No script binds here, so the runner exits with usage rather than
      // dropping the arguments the parameters do not name.
      "separator ahead of the script": [
        "Things3",
        "--",
        "query-logbook.js",
        "2026-06-01T00:00:00Z",
      ],
      "script with no arguments": ["Things3", "query-list.js"],
      "app with no script": ["Things3"],
      "expression with trailing flags": ["Finder", "-e", "1 + 1", "a", "--flag", "b"],
      "expression flag before the app": ["--expression=1 + 1", "Finder", "--flag"],
    };

    const parsed = Object.fromEntries(
      Object.entries(invocations).map(([name, argv]) => [name, parseArgv(argv)]),
    );
    expect(parsed).toMatchInlineSnapshot(`
      {
        "app with no script": {
          "app": "Things3",
          "args": [],
          "expression": undefined,
          "script": undefined,
        },
        "documented logbook query": {
          "app": "Things3",
          "args": [
            "2026-06-01T00:00:00Z",
            "2026-08-15T00:00:00Z",
            "--notes-contains",
            "Discovery:",
          ],
          "expression": undefined,
          "script": "query-logbook.js",
        },
        "explicit -- separator": {
          "app": "Things3",
          "args": [
            "2026-06-01T00:00:00Z",
            "--notes-contains",
            "Discovery:",
          ],
          "expression": undefined,
          "script": "query-logbook.js",
        },
        "expression flag before the app": {
          "app": "Finder",
          "args": [
            "--flag",
          ],
          "expression": "1 + 1",
          "script": undefined,
        },
        "expression with trailing flags": {
          "app": "Finder",
          "args": [
            "a",
            "--flag",
            "b",
          ],
          "expression": "1 + 1",
          "script": undefined,
        },
        "script with no arguments": {
          "app": "Things3",
          "args": [],
          "expression": undefined,
          "script": "query-list.js",
        },
        "separator ahead of the script": {
          "app": "Things3",
          "args": [
            "query-logbook.js",
            "2026-06-01T00:00:00Z",
          ],
          "expression": undefined,
          "script": undefined,
        },
      }
    `);
  });
});

describe("isRetriableAppleEventsError", () => {
  test.each<[string, number, string, boolean]>([
    [
      "matches the -10004 privilege-violation code in stderr",
      1,
      "execution error: not allowed (-10004)",
      true,
    ],
    ["matches the -600 code in stderr", 1, "execution error: isn't running (-600)", true],
    [
      "matches a Connection Invalid XPC hiccup",
      1,
      "Connection Invalid to com.apple.hiservices-xpcservice",
      true,
    ],
    ["matches the -10004 code surfacing as the exit code", -10004, "", true],
    ["matches the -600 code surfacing as the exit code", -600, "", true],
    [
      "does not match an unrelated execution error",
      1,
      "execution error: Can't get item 5 (-1728)",
      false,
    ],
    ["does not match success", 0, "", false],
  ])("%s", (_name, code, stderr, expected) => {
    expect(isRetriableAppleEventsError(code, stderr)).toBe(expected);
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

  it("retries once on a retriable error then succeeds", async () => {
    const { run, calls } = runner([
      { code: 1, stdout: "", stderr: "execution error (-10004)" },
      { code: 0, stdout: "ok", stderr: "" },
    ]);
    const result = await runWithRetry(["-e", "x"], run, noSleep);
    expect(result).toEqual({ code: 0, stdout: "ok", stderr: "" });
    expect(calls).toHaveLength(2);
  });

  it("retries with backoff then surfaces the persistent error", async () => {
    const persistent: RunResult = { code: 1, stdout: "", stderr: "Connection Invalid" };
    const { run, calls } = runner([persistent, { ...persistent }, { ...persistent }]);
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const result = await runWithRetry(["-e", "x"], run, sleep);
    expect(result).toEqual(persistent);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([300, 900]);
  });

  it("does not retry a non-retriable failure", async () => {
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

describe("emitResult", () => {
  // Regression: stdout and stderr sharing one open file description (`2>&1`,
  // how shell tools capture combined output). Bun.write(Bun.stderr, ...) used
  // replace semantics on regular files, truncating the stdout content.
  it("preserves stdout when stderr shares the capture file", async () => {
    const dir = process.env.TMPDIR ?? "/tmp";
    const capture = join(dir, `jxa-emit-${Date.now()}.txt`);
    const fixture = join(dir, `jxa-emit-fixture-${Date.now()}.ts`);
    const jxaPath = join(import.meta.dirname, "jxa.ts");
    await Bun.write(
      fixture,
      `import { emitResult } from ${JSON.stringify(jxaPath)};\n` +
        `emitResult({ code: 0, stdout: "OUT\\n", stderr: "ERR\\n" });\n`,
    );

    const proc = Bun.spawn(["sh", "-c", `bun '${fixture}' > '${capture}' 2>&1`]);
    expect(await proc.exited).toBe(0);

    expect(await Bun.file(capture).text()).toBe("OUT\nERR\n");
  });
});
