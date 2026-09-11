import { describe, expect, test } from "bun:test";
import {
  clearArgs,
  currentPane,
  docOpenArgs,
  existingReviewr,
  markerPath,
  notificationArgs,
  openedPane,
  raiseArgs,
  reviewGlyph,
  reviewrOpenArgs,
} from "./attention";

describe("raiseArgs", () => {
  test("labels every resting state and sets the review token", () => {
    const args = raiseArgs("wE5:p1");
    // The glyph stands in as `<eye>`: a private-use codepoint inlined here is
    // one bad paste from snapshotting another icon. Its codepoint is asserted
    // below instead.
    expect(args.map((arg) => (arg === `review=${reviewGlyph}` ? "review=<eye>" : arg)))
      .toMatchInlineSnapshot(`
      [
        "pane",
        "report-metadata",
        "wE5:p1",
        "--source",
        "claude-review-human",
        "--agent",
        "claude",
        "--state-label",
        "idle=review",
        "--state-label",
        "done=review",
        "--state-label",
        "working=review",
        "--token",
        "review=<eye>",
        "--ttl-ms",
        "28800000",
      ]
    `);
  });

  test("renders nf-fa-eye", () => {
    expect(reviewGlyph.codePointAt(0)).toBe(0xf06e);
  });
});

describe("clearArgs", () => {
  test("clears the labels and token under the same source", () => {
    expect(clearArgs("wE5:p1")).toMatchInlineSnapshot(`
      [
        "pane",
        "report-metadata",
        "wE5:p1",
        "--source",
        "claude-review-human",
        "--agent",
        "claude",
        "--clear-state-labels",
        "--clear-token",
        "review",
      ]
    `);
    expect(clearArgs("wE5:p1")[4]).toBe(raiseArgs("wE5:p1")[4]);
  });
});

describe("notificationArgs", () => {
  test.each<[string, string | undefined, string[]]>([
    ["with a summary", "claude main: hook wiring", ["--body", "claude main: hook wiring"]],
    ["without a summary", undefined, []],
    ["with an empty summary", "", []],
  ])("%s", (_name, summary, body) => {
    expect(notificationArgs(summary)).toEqual([
      "notification",
      "show",
      "Review requested",
      ...body,
      "--sound",
      "request",
    ]);
  });
});

describe("markerPath", () => {
  test.each<[string, string]>([
    ["wE5:p1", "wE5-p1"],
    ["a:b:c", "a-b-c"],
    ["plain", "plain"],
  ])("%s maps to %s under the cache dir", (paneId, name) => {
    expect(markerPath(paneId, "/home/x")).toBe(`/home/x/.cache/claude/review-human/${name}`);
  });
});

describe("currentPane", () => {
  test.each<[string, Record<string, string | undefined>, string | null]>([
    ["inside herdr", { HERDR_ENV: "1", HERDR_PANE_ID: "wE5:p1" }, "wE5:p1"],
    ["outside herdr", { HERDR_PANE_ID: "wE5:p1" }, null],
    ["herdr env with no pane", { HERDR_ENV: "1" }, null],
    ["herdr env with an empty pane", { HERDR_ENV: "1", HERDR_PANE_ID: "" }, null],
  ])("%s", (_name, env, expected) => {
    expect(currentPane(env)).toBe(expected);
  });
});

describe("open targets", () => {
  test("reviewr splits beside the pane without taking focus", () => {
    expect(reviewrOpenArgs("wE5:p1", "/repo")).toMatchInlineSnapshot(`
      [
        "plugin",
        "pane",
        "open",
        "--plugin",
        "persiyanov.reviewr",
        "--entrypoint",
        "pane",
        "--placement",
        "split",
        "--target-pane",
        "wE5:p1",
        "--direction",
        "right",
        "--cwd",
        "/repo",
        "--no-focus",
      ]
    `);
  });

  test("plannotator-tui gets the file and the pane to deliver into", () => {
    expect(docOpenArgs("wE5:p1", "/repo/tmp/pr-body.md")).toMatchInlineSnapshot(`
      [
        "plugin",
        "pane",
        "open",
        "--plugin",
        "annotate",
        "--entrypoint",
        "doc",
        "--placement",
        "split",
        "--target-pane",
        "wE5:p1",
        "--direction",
        "right",
        "--cwd",
        "/repo/tmp",
        "--no-focus",
        "--env",
        "PLANNOTATOR_TUI_FILE=/repo/tmp/pr-body.md",
        "--env",
        "PLANNOTATOR_TUI_DELIVER_TO=wE5:p1",
        "--env",
        "PLANNOTATOR_TUI_DELIVER_AGENT=claude",
      ]
    `);
  });

  test("both open as a targeted, unfocused split", () => {
    for (const args of [reviewrOpenArgs("wE5:p1"), docOpenArgs("wE5:p1", "x.md")]) {
      expect(args[args.indexOf("--target-pane") + 1]).toBe("wE5:p1");
      expect(args).toContain("--no-focus");
      expect(args).not.toContain("--focus");
    }
  });
});

const opened = (paneId: string) =>
  JSON.stringify({
    result: { type: "plugin_pane_opened", plugin_pane: { pane: { pane_id: paneId } } },
  });

describe("openedPane", () => {
  test.each<[string, string, ReturnType<typeof openedPane>]>([
    ["an opened pane", opened("wE5:p3"), { pane: "wE5:p3" }],
    [
      "a herdr error",
      JSON.stringify({ error: { code: "plugin_not_found", message: "plugin not found" } }),
      { error: "plugin not found" },
    ],
    ["no output", "", { error: "herdr returned no pane" }],
    [
      "an unexpected envelope",
      JSON.stringify({ result: { type: "ok" } }),
      { error: "herdr returned no pane" },
    ],
  ])("%s", (_name, stdout, expected) => {
    expect(openedPane(stdout)).toEqual(expected);
  });
});

describe("existingReviewr", () => {
  const list = (panes: { pane_id: string; label?: string | null }[]) =>
    JSON.stringify({ result: { panes } });

  test.each<[string, string, string | null]>([
    [
      "a labeled pane",
      list([{ pane_id: "wE5:p1" }, { pane_id: "wE5:p4", label: "reviewr" }]),
      "wE5:p4",
    ],
    [
      "no reviewr pane",
      list([
        { pane_id: "wE5:p1", label: null },
        { pane_id: "wE5:p3", label: "Annotate" },
      ]),
      null,
    ],
    ["an error envelope", JSON.stringify({ error: { code: "server_unavailable" } }), null],
    ["no output", "", null],
  ])("%s", (_name, json, expected) => {
    expect(existingReviewr(json)).toBe(expected);
  });
});
