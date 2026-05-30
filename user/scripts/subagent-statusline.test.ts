import { describe, expect, test } from "bun:test";
import { formatElapsed, formatTokens, renderTask } from "./subagent-statusline";

function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal escapes
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatElapsed", () => {
  test("minutes and seconds", () => {
    expect(formatElapsed(0, 65_000)).toBe("1m 5s");
    expect(formatElapsed(0, 0)).toBe("0m 0s");
    expect(formatElapsed(10_000, 130_000)).toBe("2m 0s");
    expect(formatElapsed(0, 3_661_000)).toBe("61m 1s");
  });
});

describe("formatTokens", () => {
  test("integer below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });
  test("thousands with one decimal", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(12_340)).toBe("12.3k");
  });
});

describe("renderTask", () => {
  const now = 65_000;

  test("status icons", () => {
    expect(strip(renderTask({ id: "a", status: "completed" }, null, now, null).content)).toContain(
      "✓",
    );
    expect(strip(renderTask({ id: "a", status: "failed" }, null, now, null).content)).toContain(
      "✗",
    );
    expect(strip(renderTask({ id: "a", status: "running" }, null, now, null).content)).toContain(
      "▶",
    );
  });

  test("text falls back name then agent", () => {
    expect(strip(renderTask({ id: "a", name: "builder" }, null, now, null).content)).toContain(
      "builder",
    );
    expect(strip(renderTask({ id: "a" }, null, now, null).content)).toContain("agent");
  });

  test("description preferred over name", () => {
    const out = renderTask({ id: "a", description: "do thing", name: "builder" }, null, now, null);
    expect(strip(out.content)).toContain("do thing");
    expect(strip(out.content)).not.toContain("builder");
  });

  test("purpose glyph from agent type, none when untyped", () => {
    const explore = strip(renderTask({ id: "a", name: "x" }, null, now, "Explore").content);
    expect(explore).toContain(String.fromCodePoint(0xf002));
    const untyped = strip(renderTask({ id: "a", name: "x" }, null, now, "general-purpose").content);
    expect(untyped).not.toContain(String.fromCodePoint(0xf002));
  });

  test("remote marker only for remote_agent", () => {
    const remote = strip(
      renderTask({ id: "a", name: "x", type: "remote_agent" }, null, now, null).content,
    );
    expect(remote).toContain(String.fromCodePoint(0xf0c2));
    const local = strip(
      renderTask({ id: "a", name: "x", type: "local_agent" }, null, now, null).content,
    );
    expect(local).not.toContain(String.fromCodePoint(0xf0c2));
  });

  test("meta combines elapsed and tokens", () => {
    const out = renderTask(
      { id: "a", name: "x", startTime: 0, tokenCount: 1500 },
      null,
      now,
      null,
    );
    expect(strip(out.content)).toContain("· 1m 5s · 1.5k");
  });

  test("truncates text to columns", () => {
    const out = renderTask({ id: "a", description: "x".repeat(80) }, 20, now, null);
    expect(Bun.stringWidth(out.content)).toBeLessThanOrEqual(20);
    expect(strip(out.content)).toContain("…");
  });

  test("id passes through", () => {
    expect(renderTask({ id: "task-7", name: "x" }, null, now, null).id).toBe("task-7");
  });
});
