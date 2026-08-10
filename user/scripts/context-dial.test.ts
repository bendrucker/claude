import { describe, expect, test } from "bun:test";
import { CONTEXT_TOKENS, cachePath, findPane, reportArgs, shouldReport } from "./context-dial";

const HOUR_MS = 3_600_000;

const paneList = JSON.stringify({
  id: "cli:pane:list",
  result: {
    type: "pane_list",
    panes: [
      { pane_id: "w1:p1", agent_status: "unknown" },
      {
        pane_id: "w2:p1",
        agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "session-a" },
      },
      {
        pane_id: "w2:p2",
        agent_session: { agent: "claude", kind: "id", source: "herdr:claude", value: "session-b" },
      },
    ],
  },
});

describe("findPane", () => {
  test.each([
    ["matching session", "session-b", "w2:p2"],
    ["unknown session", "session-z", null],
  ])("%s", (_name, sessionId, expected) => {
    expect(findPane(paneList, sessionId)).toBe(expected);
  });

  test.each([
    ["malformed json", "not json"],
    ["empty output", ""],
    ["error envelope", JSON.stringify({ error: { code: "server_unavailable" } })],
  ])("%s yields no pane", (_name, output) => {
    expect(findPane(output, "session-a")).toBeNull();
  });
});

describe("shouldReport", () => {
  const now = 1_000 * HOUR_MS;

  test.each([
    ["no cache", null, true],
    ["same dial, fresh", { sig: "ctx_mid=x", at: now - 1_000 }, false],
    ["same dial, stale", { sig: "ctx_mid=x", at: now - HOUR_MS }, true],
    ["different glyph", { sig: "ctx_mid=y", at: now }, true],
    ["different token", { sig: "ctx_high=x", at: now }, true],
  ])("%s", (_name, cached, expected) => {
    expect(shouldReport(cached, "ctx_mid=x", now)).toBe(expected);
  });
});

describe("reportArgs", () => {
  test("sets the live token and clears the other levels", () => {
    expect(reportArgs("w2:p2", { token: "ctx_high", value: "\u{f0aa2}" })).toMatchInlineSnapshot(`
      [
        "pane",
        "report-metadata",
        "w2:p2",
        "--source",
        "claude-statusline",
        "--ttl-ms",
        "86400000",
        "--token",
        "ctx_high=󰪢",
        "--clear-token",
        "ctx_low",
        "--clear-token",
        "ctx_mid",
        "--clear-token",
        "ctx_crit",
      ]
    `);
  });

  const levels = CONTEXT_TOKENS.map((token) => [token] as const);

  test.each(levels)("%s clears every other level", (token) => {
    const args = reportArgs("w2:p2", { token, value: "\u{f0a9e}" });
    const cleared = args.filter((_arg, i) => args[i - 1] === "--clear-token");
    expect(cleared).toEqual(CONTEXT_TOKENS.filter((other) => other !== token));
  });
});

describe("cachePath", () => {
  test("keeps a session-scoped file out of the session's own tree", () => {
    const path = cachePath("4cba0d0a-8875-48eb-b6cd-90874f2a875b");
    expect(path).toEndWith("claude-context-dial/4cba0d0a-8875-48eb-b6cd-90874f2a875b.json");
  });

  test("sanitizes a session id that would escape the directory", () => {
    expect(cachePath("../../etc/passwd")).toEndWith("claude-context-dial/..-..-etc-passwd.json");
  });
});
