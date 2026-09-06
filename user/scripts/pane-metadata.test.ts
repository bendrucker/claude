import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brandGlyph } from "./glyphs";
import {
  CONTEXT_TOKENS,
  cachePath,
  childArgs,
  findPane,
  readSessionTitle,
  reportArgs,
  reportSignature,
  scanTitles,
  shouldReport,
  titleCachePath,
} from "./pane-metadata";

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
    const args = reportArgs("w2:p2", { token: "ctx_high", value: "\u{f0aa2}" }, null);
    // The mark stands in as `<brand>`: a private-use glyph inlined here is one
    // bad paste away from silently snapshotting some other icon. Its codepoint
    // is asserted below instead.
    expect(args.map((arg) => (arg === brandGlyph ? "<brand>" : arg))).toMatchInlineSnapshot(`
      [
        "pane",
        "report-metadata",
        "w2:p2",
        "--source",
        "claude-statusline",
        "--ttl-ms",
        "86400000",
        "--display-agent",
        "<brand>",
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

  test("carries the brand mark with no dial to report", () => {
    const args = reportArgs("w2:p2", null, null);
    expect(args).toEqual([
      "pane",
      "report-metadata",
      "w2:p2",
      "--source",
      "claude-statusline",
      "--ttl-ms",
      "86400000",
      "--display-agent",
      brandGlyph,
    ]);
  });

  test("brands the pane whether or not a dial rides along", () => {
    for (const report of [null, { token: "ctx_low", value: "x" } as const]) {
      const args = reportArgs("w2:p2", report, null);
      expect(args[args.indexOf("--display-agent") + 1]).toBe(brandGlyph);
    }
  });

  test("sets the title token the sidebar binds to", () => {
    const args = reportArgs("w2:p2", null, "Herdr sidebar redesign");
    expect(args.slice(args.indexOf("--token"))).toEqual([
      "--token",
      "title=Herdr sidebar redesign",
    ]);
  });

  test("carries the title alongside the dial", () => {
    const args = reportArgs("w2:p2", { token: "ctx_mid", value: "x" }, "Named");
    const tokens = args.filter((_arg, i) => args[i - 1] === "--token");
    expect(tokens).toEqual(["title=Named", "ctx_mid=x"]);
  });

  test("leaves the title standing when the session has no name yet", () => {
    const args = reportArgs("w2:p2", { token: "ctx_mid", value: "x" }, null);
    expect(args).not.toContain("title");
    expect(args.filter((_arg, i) => args[i - 1] === "--clear-token")).not.toContain("title");
  });

  const levels = CONTEXT_TOKENS.map((token) => [token] as const);

  test.each(levels)("%s clears every other level", (token) => {
    const args = reportArgs("w2:p2", { token, value: "\u{f0a9e}" }, null);
    const cleared = args.filter((_arg, i) => args[i - 1] === "--clear-token");
    expect(cleared).toEqual(CONTEXT_TOKENS.filter((other) => other !== token));
  });
});

describe("reportSignature", () => {
  test("separates a dial from no dial, so the first one re-reports", () => {
    expect(reportSignature({ token: "ctx_low", value: "x" }, null)).not.toBe(
      reportSignature(null, null),
    );
  });

  test("moves when the mark moves, so a changed glyph is not cached away", () => {
    expect(reportSignature(null, null)).toStartWith(brandGlyph);
  });

  test("moves on a rename, so the new title reaches herdr", () => {
    const dial = { token: "ctx_low", value: "x" } as const;
    expect(reportSignature(dial, "Pane title token")).not.toBe(reportSignature(dial, "Renamed"));
  });

  test("separates a named session from an unnamed one", () => {
    expect(reportSignature(null, "Named")).not.toBe(reportSignature(null, null));
  });
});

describe("cachePath", () => {
  test("keeps a session-scoped file out of the session's own tree", () => {
    const path = cachePath("4cba0d0a-8875-48eb-b6cd-90874f2a875b");
    expect(path).toEndWith("claude-pane-metadata/4cba0d0a-8875-48eb-b6cd-90874f2a875b.json");
  });

  test("sanitizes a session id that would escape the directory", () => {
    expect(cachePath("../../etc/passwd")).toEndWith("claude-pane-metadata/..-..-etc-passwd.json");
  });
});

const aiTitle = (title: string) =>
  `${JSON.stringify({ type: "ai-title", aiTitle: title, sessionId: "session-a" })}\n`;
const customTitle = (title: string) =>
  `${JSON.stringify({ type: "custom-title", customTitle: title, sessionId: "session-a" })}\n`;
const turn = (text: string) =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;

describe("scanTitles", () => {
  test.each([
    ["names the session", aiTitle("Herdr sidebar redesign"), "Herdr sidebar redesign"],
    ["takes a /title rename", customTitle("screens"), "screens"],
    ["takes the latest of either kind", aiTitle("First") + customTitle("Second"), "Second"],
    ["takes the latest rename", customTitle("Second") + aiTitle("Third"), "Third"],
    ["flattens a multi-line title", aiTitle("Two\nlines"), "Two lines"],
    ["ignores a turn quoting the record", turn(JSON.stringify({ type: "ai-title" })), null],
    ["ignores a record with no title", `${JSON.stringify({ type: "ai-title" })}\n`, null],
    ["ignores a malformed line", '{"type":"ai-title",\n', null],
    ["ignores a blank title", aiTitle("   "), null],
  ])("%s", (_name, chunk, expected) => {
    expect(scanTitles(chunk, null).title).toBe(expected);
  });

  test("carries the standing title through a chunk that names none", () => {
    expect(scanTitles(turn("hello"), "Standing").title).toBe("Standing");
  });

  test("leaves a half-written record for the render that sees it finished", () => {
    const chunk = `${turn("hello")}${aiTitle("Named").trimEnd()}`;
    const scan = scanTitles(chunk, null);
    expect(scan.title).toBeNull();
    expect(scan.consumed).toBe(Buffer.byteLength(turn("hello")));
  });

  test("resumes on a line boundary through a multi-byte title", () => {
    const chunk = aiTitle("Café ☕");
    expect(scanTitles(chunk, null)).toEqual({
      title: "Café ☕",
      consumed: Buffer.byteLength(chunk),
    });
  });
});

describe("childArgs", () => {
  test("passes the title alongside the dial", () => {
    expect(childArgs("session-a", { token: "ctx_mid", value: "x" }, "Named")).toEqual([
      "session-a",
      "ctx_mid",
      "x",
      "Named",
    ]);
  });

  test("holds an absent dial's place so the title stays readable by position", () => {
    expect(childArgs("session-a", null, "Named")).toEqual(["session-a", "", "", "Named"]);
  });
});

describe("readSessionTitle", () => {
  async function withTranscript(
    body: (path: string, sessionId: string) => Promise<void>,
  ): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "pane-title-"));
    const sessionId = `test-${crypto.randomUUID()}`;
    try {
      await body(join(dir, "transcript.jsonl"), sessionId);
    } finally {
      await Promise.all([
        rm(dir, { recursive: true, force: true }),
        rm(titleCachePath(sessionId), { recursive: true, force: true }),
      ]);
    }
  }

  test("reads a title appended after the session was already scanned", async () => {
    await withTranscript(async (path, sessionId) => {
      await Bun.write(path, turn("hello"));
      expect(await readSessionTitle(path, sessionId)).toBeNull();

      await Bun.write(path, turn("hello") + aiTitle("Named"));
      expect(await readSessionTitle(path, sessionId)).toBe("Named");

      await Bun.write(path, turn("hello") + aiTitle("Named") + customTitle("Renamed"));
      expect(await readSessionTitle(path, sessionId)).toBe("Renamed");
    });
  });

  test("scans only the bytes appended since the last render", async () => {
    await withTranscript(async (path, sessionId) => {
      await Bun.write(path, aiTitle("Named"));
      expect(await readSessionTitle(path, sessionId)).toBe("Named");
      expect(await Bun.file(titleCachePath(sessionId)).json()).toEqual({
        offset: Bun.file(path).size,
        title: "Named",
      });

      // A record already behind the cached offset is never reread, so a
      // transcript that grows without naming a new title costs one short read.
      await Bun.write(path, aiTitle("Rewritten") + turn("hello"));
      expect(await readSessionTitle(path, sessionId)).toBe("Named");
    });
  });

  test("rereads a transcript that was replaced rather than appended to", async () => {
    await withTranscript(async (path, sessionId) => {
      await Bun.write(path, turn("hello") + aiTitle("Named"));
      expect(await readSessionTitle(path, sessionId)).toBe("Named");

      await Bun.write(path, aiTitle("Fresh"));
      expect(await readSessionTitle(path, sessionId)).toBe("Fresh");
    });
  });

  test("stands by a scanned title the cache could not be written for", async () => {
    await withTranscript(async (path, sessionId) => {
      // A directory where the cache file goes fails the write and nothing else,
      // so the scan still has the title the transcript names.
      mkdirSync(titleCachePath(sessionId), { recursive: true });
      await Bun.write(path, aiTitle("Named"));
      expect(await readSessionTitle(path, sessionId)).toBe("Named");
    });
  });

  test("yields no title for a transcript that does not exist", async () => {
    await withTranscript(async (_path, sessionId) => {
      expect(await readSessionTitle("/nonexistent/transcript.jsonl", sessionId)).toBeNull();
    });
  });
});

describe("titleCachePath", () => {
  test("sits beside the report cache without colliding with it", () => {
    const sessionId = "4cba0d0a-8875-48eb-b6cd-90874f2a875b";
    expect(titleCachePath(sessionId)).toEndWith(
      "claude-pane-metadata/4cba0d0a-8875-48eb-b6cd-90874f2a875b.title.json",
    );
    expect(titleCachePath(sessionId)).not.toBe(cachePath(sessionId));
  });
});
