import type { ProcessRunResult } from "claude-code";
import { describe, expect, test } from "claude-code/testing";
import { DEFAULTS, type Shell, detect, parse } from "./shell";

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

interface Probe {
  shell: Shell;
  argvs: string[][];
}

async function probeOf(
  variables: Record<string, string>,
  reply: () => ProcessRunResult,
): Promise<Probe> {
  const argvs: string[][] = [];
  const $: Parameters<typeof detect>[0] = {
    env: { get: (name) => Promise.resolve(variables[name]) },
    process: {
      run: (argv) => {
        argvs.push([...argv]);
        return Promise.resolve().then(reply);
      },
    },
  };
  return { shell: await detect($), argvs };
}

describe("detect", () => {
  test("probes the SHELL path and parses the output", async () => {
    const probe = await probeOf({ SHELL: "/opt/bin/zsh" }, () => ran("5.9.2\non\non\noff\non\n"));
    expect(probe.shell).toMatchObject({
      path: "/opt/bin/zsh",
      version: "5.9.2",
      active: true,
      gates: { glob: false, equals: true },
      error: null,
    });
    expect(probe.argvs).toHaveLength(1);
    expect(probe.argvs[0]?.slice(0, 2)).toEqual(["/opt/bin/zsh", "-c"]);
    expect(probe.argvs[0]?.[2]).toContain("ZSH_VERSION");
  });

  test("leaves a non-zsh shell inert", async () => {
    const probe = await probeOf({ SHELL: "/bin/bash" }, () => ran("\n\n\n\n\n"));
    expect(probe.shell).toMatchObject({ path: "/bin/bash", active: false, error: null });
  });

  test("resolves the shell in the Bash tool's order", async () => {
    const cases: [string, Record<string, string>, string][] = [
      ["override wins", { CLAUDE_CODE_SHELL: "/opt/zsh", SHELL: "/bin/bash" }, "/opt/zsh"],
      ["invalid override", { CLAUDE_CODE_SHELL: "/bin/fish", SHELL: "/bin/zsh" }, "/bin/zsh"],
      ["SHELL alone", { SHELL: "/bin/bash" }, "/bin/bash"],
      ["unsupported SHELL", { SHELL: "/usr/bin/fish" }, "zsh"],
      ["nothing set", {}, "zsh"],
    ];
    const probes = await Promise.all(
      cases.map(([, variables]) => probeOf(variables, () => ran(ZSH_DEFAULTS))),
    );
    expect(probes.map((p) => p.argvs[0]?.[0])).toEqual(cases.map((row) => row[2]));
  });

  const failures: [string, string, boolean][] = [
    ["zsh path", "/usr/bin/zsh", true],
    ["bash path", "/bin/bash", false],
  ];

  test("falls back to defaults when the probe fails", async () => {
    const rows = failures.flatMap(
      ([name, path, active]): [string, string, boolean, () => ProcessRunResult, string][] => [
        [`${name} exits nonzero`, path, active, () => ran("", 2), "probe exited 2"],
        [
          `${name} throws`,
          path,
          active,
          () => {
            throw new Error("timed out");
          },
          "timed out",
        ],
      ],
    );
    const probes = await Promise.all(
      rows.map(([, path, , reply]) => probeOf({ SHELL: path }, reply)),
    );
    for (const [i, [name, path, active, , error]] of rows.entries()) {
      expect({ name, shell: probes[i]?.shell }).toMatchObject({
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
