import type { ProcessRunResult } from "claude-code";
import { describe, expect, test } from "claude-code/testing";
import { fallback, parse, probed, resolve } from "./shell";

function ran(stdout: string, exitCode = 0): ProcessRunResult {
  return { exitCode, stdout, stderr: "", isStdoutTruncated: false, isStderrTruncated: false };
}

describe("parse", () => {
  test("reads the version, and treats a blank one as not zsh", () => {
    const cases: [string, string, Partial<ReturnType<typeof parse>>][] = [
      ["zsh", "5.9.2\n", { version: "5.9.2", active: true }],
      ["bash prints a blank", "\n", { version: null, active: false }],
      ["empty output", "", { version: null, active: false }],
    ];
    for (const [name, stdout, expected] of cases) {
      const shell = parse("/bin/sh", stdout);
      expect({ name, shell }).toMatchObject({
        name,
        shell: { path: "/bin/sh", error: null, ...expected },
      });
    }
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
    expect(probed("/opt/bin/zsh", ran("5.9.2\n"))).toMatchObject({
      path: "/opt/bin/zsh",
      version: "5.9.2",
      active: true,
      error: null,
    });
    expect(probed("/bin/bash", ran("\n"))).toMatchObject({
      path: "/bin/bash",
      active: false,
      error: null,
    });
  });

  test("falls back on the path's name when the probe fails", () => {
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
        shell: { path, active, version: null, error },
      });
    }
  });
});
