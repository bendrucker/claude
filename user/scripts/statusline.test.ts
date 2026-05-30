import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildStatusLine,
  dialColor,
  dialIndex,
  elideSpans,
  formatWorktree,
  type Span,
  type WorktreeData,
} from "./statusline";

// Strip ANSI SGR and OSC 8 sequences, matching the golden-fixture comparison:
// styleText uses attribute-specific resets (\x1b[39m) where bash uses \x1b[0m,
// so raw bytes differ but the visible status line must match exactly.
function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, "");
}

interface Fixture {
  name: string;
  columns: number;
  stdin: Parameters<typeof buildStatusLine>[0];
  worktree: WorktreeData | null;
}

const fixturesDir = join(import.meta.dirname, "fixtures");
const manifest = (await Bun.file(join(fixturesDir, "manifest.json")).json()) as Fixture[];

describe("golden parity", () => {
  for (const fx of manifest) {
    test(fx.name, async () => {
      const want = await Bun.file(join(fixturesDir, `${fx.name}.out`)).text();
      const got = buildStatusLine(fx.stdin, fx.columns, fx.worktree);
      expect(strip(got)).toBe(strip(want));
      expect(Bun.stringWidth(got)).toBe(Bun.stringWidth(want));
    });
  }
});

describe("dialColor", () => {
  test("thresholds", () => {
    expect(dialColor(0, false)).toBe("green");
    expect(dialColor(39, false)).toBe("green");
    expect(dialColor(40, false)).toBe("yellow");
    expect(dialColor(64, false)).toBe("yellow");
    expect(dialColor(65, false)).toBe("redBright");
    expect(dialColor(79, false)).toBe("redBright");
    expect(dialColor(80, false)).toBe("red");
    expect(dialColor(100, false)).toBe("red");
  });

  test("exceeds_200k escalation", () => {
    expect(dialColor(30, true)).toBe("yellow"); // green -> yellow
    expect(dialColor(44, true)).toBe("yellow"); // yellow stays (< 45)
    expect(dialColor(45, true)).toBe("red"); // yellow -> red (>= 45)
    expect(dialColor(70, true)).toBe("redBright"); // redBright unaffected
    expect(dialColor(85, true)).toBe("red"); // red unaffected
  });
});

describe("dialIndex", () => {
  test("ramp and cap", () => {
    expect(dialIndex(0)).toBe(0);
    expect(dialIndex(39)).toBe(2);
    expect(dialIndex(50)).toBe(3);
    expect(dialIndex(100)).toBe(7);
    expect(dialIndex(120)).toBe(7); // capped
  });
});

describe("elideSpans", () => {
  const span = (text: string, pre = "", suf = ""): Span => ({ text, pre, suf });

  test("fits within budget returns all spans wrapped", () => {
    const out = elideSpans([span("ab", "<", ">"), span("cd")], 10);
    expect(out).toBe("<ab>cd");
  });

  test("single span middle-elide", () => {
    const out = elideSpans([span("abcdefghij")], 5);
    expect(strip(out)).toBe("ab…ij");
  });

  test("preserves wrappers around surviving pieces", () => {
    const out = elideSpans([span("aaaa", "[", "]"), span("bbbb", "{", "}")], 5);
    // head=2 -> "aa" from first span; tail=2 -> "bb" from last span
    expect(out).toBe("[aa]{…bb}");
  });

  test("multi-byte branch elides on codepoint boundaries", () => {
    const out = elideSpans([span("日本語のブランチ名前")], 5);
    expect(strip(out)).toBe("日本…名前");
  });
});

describe("formatWorktree redundancy collapse", () => {
  const base: WorktreeData = {
    branch: "",
    path: "",
    isMain: false,
    ciUrl: null,
    repoUrl: null,
    ahead: 0,
  };

  test("branch carrying repo as suffix shows branch alone", () => {
    const out = formatWorktree(
      { ...base, branch: "worktree-abc123", path: "/x/abc123.worktree-abc123" },
      80,
    );
    expect(strip(out.join("  "))).toBe("worktree-abc123");
  });

  test("independent repo and branch shows repo/branch", () => {
    const out = formatWorktree({ ...base, branch: "feature/x", path: "/x/myrepo" }, 80);
    expect(strip(out.join("  "))).toBe("myrepo/feature/x");
  });

  test("main shows repo alone", () => {
    const out = formatWorktree({ ...base, isMain: true, branch: "main", path: "/x/myrepo" }, 80);
    expect(strip(out.join("  "))).toBe("myrepo");
  });

  test("ahead segment reserved and appended", () => {
    const out = formatWorktree(
      { ...base, isMain: true, branch: "main", path: "/x/myrepo", ahead: 4 },
      80,
    );
    expect(out.map(strip)).toEqual(["myrepo", "↑4"]);
  });

  test("budget too small drops the label, keeps ahead segment", () => {
    const out = formatWorktree(
      { ...base, isMain: true, branch: "main", path: "/x/myrepo", ahead: 5 },
      4,
    );
    expect(out.map(strip)).toEqual(["↑5"]);
  });

  test("budget too small with no ahead yields nothing", () => {
    const out = formatWorktree({ ...base, isMain: true, branch: "main", path: "/x/myrepo" }, 2);
    expect(out).toEqual([]);
  });
});
