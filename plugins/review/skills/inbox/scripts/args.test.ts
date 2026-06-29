import { describe, expect, test } from "bun:test";
import { buildWtArgs, PERMISSION_MODES, type PermissionMode, parsePermissionMode } from "./args";

const modeRows: [PermissionMode][] = PERMISSION_MODES.map((mode) => [mode]);

describe("buildWtArgs", () => {
  test("omitted permissionMode matches the historical hardcoded array", () => {
    expect(
      buildWtArgs({ paneName: "review-o-r-1", sessionId: "sid", prompt: "/review:peer u" }),
    ).toEqual([
      "wt",
      "switch",
      "--create",
      "review-o-r-1",
      "-x",
      "claude",
      "--",
      "--session-id",
      "sid",
      "--name",
      "review-o-r-1",
      "/review:peer u",
    ]);
  });

  test.each(modeRows)("mode %s appears once between --name and prompt", (mode) => {
    const args = buildWtArgs({
      paneName: "pane",
      sessionId: "sid",
      prompt: "PROMPT",
      permissionMode: mode,
    });

    expect(args.filter((a) => a === "--permission-mode")).toHaveLength(1);

    const flagIndex = args.indexOf("--permission-mode");
    const nameValueIndex = args.indexOf("--name") + 1;
    expect(flagIndex).toBe(nameValueIndex + 1);
    expect(args[flagIndex + 1]).toBe(mode);
    expect(args[flagIndex + 2]).toBe("PROMPT");
    expect(args.at(-1)).toBe("PROMPT");
  });
});

describe("parsePermissionMode", () => {
  test.each(modeRows)("returns %s for a valid mode", (mode) => {
    expect(parsePermissionMode(mode)).toBe(mode);
  });

  test("throws for an unknown mode", () => {
    expect(() => parsePermissionMode("nope")).toThrow("Invalid permission mode: nope");
  });
});
