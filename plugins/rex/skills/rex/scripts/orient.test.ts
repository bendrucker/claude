import { describe, expect, test } from "bun:test";
import { hostsLine, orientation, programName } from "./orient";

const inspect = {
  label: "work",
  active_window_id: "window:b",
  windows: [
    {
      window_id: "window:a",
      label: "Editor",
      focused_block_id: "block:1",
      layers: [
        {
          blocks: [
            { block_id: "block:1", label: "shell" },
            { block_id: "block:2", label: "logs" },
          ],
        },
      ],
    },
    {
      window_id: "window:b",
      label: "Claude",
      focused_block_id: "block:3",
      layers: [{ blocks: [{ block_id: "block:3", label: "shell" }] }],
    },
  ],
};

const processes = new Map([
  ["block:1", { foreground: { name: "nvim", argv0: "nvim", cwd: "/work/app" } }],
  ["block:2", { foreground: { name: "tail", argv0: "tail", cwd: "/work/app" } }],
  ["block:3", { foreground: { name: "2.1.314", argv0: "claude", cwd: "/work/app" } }],
]);

describe("programName", () => {
  test("strips the login-shell dash", () => {
    expect(programName({ foreground: { name: "zsh", argv0: "-zsh" } })).toBe("zsh");
  });

  test("prefers argv0 over a version-numbered binary name", () => {
    expect(programName({ foreground: { name: "2.1.314", argv0: "claude" } })).toBe("claude");
  });

  test("is empty without a foreground process", () => {
    expect(programName(undefined)).toBe("");
  });
});

describe("orientation", () => {
  const lines = orientation(inspect, processes, "block:3").split("\n");

  test("heads with the session label and this block", () => {
    expect(lines[0]).toBe('session "work"   this block: block:3');
  });

  test("lists one tab line per window and marks the active one", () => {
    expect(lines).toContain('tab 1  window:a  "Editor"');
    expect(lines).toContain('tab 2  window:b  "Claude"  *active*');
  });

  test("lists each block with label, cwd, and program", () => {
    expect(lines).toContain('  block:2  "logs"  /work/app  tail');
  });

  test("marks the focused block and this block", () => {
    expect(lines).toContain('  block:1  *focused*  "shell"  /work/app  nvim');
    expect(lines).toContain('  block:3  *focused*  *this*  "shell"  /work/app  claude');
  });

  test("omits cwd and program for a block whose process lookup failed", () => {
    const out = orientation(inspect, new Map(), "block:3");
    expect(out).toContain('  block:2  "logs"');
    expect(out).not.toContain("/work/app");
  });
});

describe("hostsLine", () => {
  test("lists labels without endpoints", () => {
    const listing = JSON.stringify({
      home: { label: "", endpoint: "unix:///sock" },
      hosts: [{ label: "studio", endpoint: "ssh://example.invalid" }, { label: "" }],
    });
    expect(hostsLine(listing)).toBe("hosts saved (reach unverified, pass -S <label>): studio");
  });

  test("is null with no hosts", () => {
    expect(hostsLine(JSON.stringify({ hosts: [] }))).toBeNull();
  });

  test("is null on failure or malformed output", () => {
    expect(hostsLine(null)).toBeNull();
    expect(hostsLine("not json")).toBeNull();
  });
});
