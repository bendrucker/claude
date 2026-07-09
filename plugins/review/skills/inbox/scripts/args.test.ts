import { describe, expect, test } from "bun:test";
import {
  buildDispatchArgs,
  PERMISSION_MODES,
  type PermissionMode,
  parseBackgroundedId,
  parsePermissionMode,
} from "./args";

const ESC = String.fromCharCode(27);
const modeRows: [PermissionMode][] = PERMISSION_MODES.map((mode) => [mode]);

describe("buildDispatchArgs", () => {
  test("omitted permissionMode dispatches the review agent in the background", () => {
    expect(buildDispatchArgs({ url: "https://github.com/o/r/pull/1" })).toEqual([
      "--bg",
      "--agent",
      "review",
      "https://github.com/o/r/pull/1",
    ]);
  });

  test.each(modeRows)("mode %s appears once, just before the url", (mode) => {
    const args = buildDispatchArgs({ url: "URL", permissionMode: mode });

    expect(args.filter((a) => a === "--permission-mode")).toHaveLength(1);

    const flagIndex = args.indexOf("--permission-mode");
    expect(args[flagIndex + 1]).toBe(mode);
    expect(args[flagIndex + 2]).toBe("URL");
    expect(args.at(-1)).toBe("URL");
  });
});

describe("parseBackgroundedId", () => {
  test.each<[string, string, string | null]>([
    [
      "ansi-wrapped id",
      `backgrounded · ${ESC}[36me80ff70a${ESC}[39m\n  claude agents\n`,
      "e80ff70a",
    ],
    ["plain id", "backgrounded · 4b7077bc\n", "4b7077bc"],
    ["absent", "some other output\n", null],
  ])("%s", (_name, stdout, expected) => {
    expect(parseBackgroundedId(stdout)).toBe(expected);
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
