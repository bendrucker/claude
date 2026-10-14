import type { ProcessRunResult } from "claude-code";
import { describe, expect, test } from "claude-code/testing";
import { DEFAULTS, fallback, parse, probed, resolve } from "./shell";

function ran(stdout: string, exitCode = 0): ProcessRunResult {
  return { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false };
}

const ZSH_DEFAULTS = "5.9.2\non\noff\noff\non\n";

describe("parse", () => {
  const cases: [string, string, Partial<ReturnType<typeof parse>>, Record<string, boolean>][] = [
    [
      "zsh defaults",
      ZSH_DEFAULTS,
      { version: "5.9.2", active: true },
      { glob: true, equals: true },
    ],
    ["nullglob on", "5.9.2\non\non\noff\non\n", { active: true }, { glob: false, equals: true }],
    ["cshnullglob on", "5.9.2\non\noff\non\non\n", { active: true }, { glob: false, equals: true }],
    ["nomatch off", "5.9.2\noff\noff\noff\non\n", { active: true }, { glob: false, equals: true }],
    ["noequals", "5.9.2\non\noff\noff\noff\n", { active: true }, { glob: true, equals: false }],
    [
      "bash prints blanks",
      "\n\n\n\n\n",
      { version: null, active: false },
      { glob: true, equals: true },
    ],
    ["empty output", "", { version: null, active: false }, { glob: true, equals: true }],
  ];

  test("reads the version and gates", () => {
    for (const [name, stdout, expected, gates] of cases) {
      const shell = parse("/bin/sh", stdout);
      expect({ name, shell }).toMatchObject({
        name,
        shell: { path: "/bin/sh", error: null, gates, ...expected },
      });
    }
  });

  test("reads each option from its own line", () => {
    expect(parse("/bin/zsh", "5.9.2\noff\non\noff\noff\n").options).toEqual({
      nomatch: false,
      nullglob: true,
      cshnullglob: false,
      equals: false,
    });
  });
});

describe("resolve", () => {
  test("picks the shell in the Bash tool's order", () => {
    const cases: [string, (string | undefined)[], string][] = [
      ["override wins", ["/opt/zsh", "/bin/bash"], "/opt/zsh"],
      ["invalid override", ["/bin/fish", "/bin/zsh"], "/bin/zsh"],
      ["SHELL alone", [undefined, "/bin/bash"], "/bin/bash"],
      ["unsupported SHELL", [undefined, "/usr/bin/fish"], "zsh"],
      ["nothing set", [undefined, undefined], "zsh"],
    ];
    for (const [name, candidates, want] of cases) {
      expect({ name, got: resolve(candidates) }).toEqual({ name, got: want });
    }
  });
});

describe("probed", () => {
  test("parses a zsh probe and leaves a non-zsh shell inert", () => {
    expect(probed("/opt/bin/zsh", ran("5.9.2\non\non\noff\non\n"))).toMatchObject({
      path: "/opt/bin/zsh",
      version: "5.9.2",
      active: true,
      gates: { glob: false, equals: true },
      error: null,
    });
    expect(probed("/bin/bash", ran("\n\n\n\n\n"))).toMatchObject({
      path: "/bin/bash",
      active: false,
      error: null,
    });
  });

  test("falls back to defaults when the probe fails", () => {
    const cases: [string, ReturnType<typeof fallback>, string, boolean, string][] = [
      [
        "zsh exits nonzero",
        probed("/usr/bin/zsh", ran("", 2)),
        "/usr/bin/zsh",
        true,
        "probe exited 2",
      ],
      ["bash exits nonzero", probed("/bin/bash", ran("", 2)), "/bin/bash", false, "probe exited 2"],
      ["zsh throws", fallback("/usr/bin/zsh", "timed out"), "/usr/bin/zsh", true, "timed out"],
    ];
    for (const [name, shell, path, active, error] of cases) {
      expect({ name, shell }).toMatchObject({
        name,
        shell: {
          path,
          active,
          version: null,
          options: DEFAULTS,
          gates: { glob: true, equals: true },
          error,
        },
      });
    }
  });
});
