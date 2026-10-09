import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import {
  clearArgs,
  currentPane,
  docOpenArgs,
  existingReviewr,
  isKind,
  kinds,
  markerPath,
  notificationArgs,
  openedPane,
  planTitle,
  PROMPT_MARKER,
  promptAction,
  raiseArgs,
  reviewGlyph,
  reviewrOpenArgs,
} from "./attention";

describe("raiseArgs", () => {
  test("labels every resting state and sets the review token", () => {
    const args = raiseArgs("wE5:p1", "plan", "dotfiles herdr-cleanup:\n approve the plan");
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
        "--token",
        "review_kind=plan",
        "--token",
        "review_summary=dotfiles herdr-cleanup: approve the plan",
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
  test("clears the labels and all three tokens under the same source", () => {
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
        "--clear-token",
        "review_kind",
        "--clear-token",
        "review_summary",
      ]
    `);
    expect(clearArgs("wE5:p1")[4]).toBe(raiseArgs("wE5:p1", "code", "x")[4]);
  });

  test("clears every token raise sets", () => {
    const raised = raiseArgs("wE5:p1", "doc", "x");
    const set = raised.flatMap((arg, i) =>
      raised[i - 1] === "--token" ? [arg.slice(0, arg.indexOf("="))] : [],
    );
    const cleared = clearArgs("wE5:p1");
    expect(cleared.flatMap((arg, i) => (cleared[i - 1] === "--clear-token" ? [arg] : []))).toEqual(
      set,
    );
  });
});

describe("raise flags", () => {
  test.each<[string, string[], number, string]>([
    ["an unknown kind", ["--kind", "review", "--summary", "x"], 1, "--kind must be one of"],
    ["no kind", ["--summary", "x"], 1, "--kind must be one of"],
    ["no summary", ["--kind", "code"], 1, "--summary is required"],
    ["a blank summary", ["--kind", "code", "--summary", " \n"], 1, "--summary is required"],
    ["valid flags outside herdr", ["--kind", "pr-body", "--summary", "x"], 0, ""],
  ])("%s", (_name, flags, exitCode, stderr) => {
    const run = Bun.spawnSync(
      ["bun", join(import.meta.dirname, "attention.ts"), "raise", ...flags],
      { env: { PATH: process.env.PATH } },
    );
    expect(run.exitCode).toBe(exitCode);
    expect(run.stderr.toString()).toContain(stderr);
  });
});

describe("isKind", () => {
  test("accepts exactly the board's five kinds", () => {
    expect(kinds).toEqual(["plan", "code", "pr-body", "doc", "question"]);
    expect(kinds.every(isKind)).toBe(true);
    expect(["", "pr_body", "Plan", "review"].some(isKind)).toBe(false);
  });
});

const hook = (event: string, tool: string, input: unknown) =>
  JSON.stringify({ hook_event_name: event, tool_name: tool, tool_input: input });

describe("promptAction", () => {
  const plan = "# Worktrunk data\n\nSteps...";
  const questions = [
    { header: "Approach", question: "Which store?", options: [] },
    { header: "Scope", question: "Both repos?", options: [] },
  ];

  test.each<[string, string, ReturnType<typeof promptAction>]>([
    [
      "a plan approval raises plan",
      hook("PreToolUse", "ExitPlanMode", { plan }),
      { clear: false, kind: "plan", summary: "dotfiles main: approve the Worktrunk data plan" },
    ],
    [
      "a plan with no heading",
      hook("PreToolUse", "ExitPlanMode", {}),
      { clear: false, kind: "plan", summary: "dotfiles main: approve the plan" },
    ],
    [
      "a question raises question",
      hook("PreToolUse", "AskUserQuestion", { questions: questions.slice(0, 1) }),
      { clear: false, kind: "question", summary: "dotfiles main: Approach: Which store?" },
    ],
    [
      "several questions count the rest",
      hook("PreToolUse", "AskUserQuestion", { questions }),
      {
        clear: false,
        kind: "question",
        summary: "dotfiles main: Approach: Which store? (+1 more)",
      },
    ],
    ["an approved plan clears", hook("PostToolUse", "ExitPlanMode", { plan }), { clear: true }],
    ["an answer clears", hook("PostToolUse", "AskUserQuestion", { questions }), { clear: true }],
    ["another tool", hook("PreToolUse", "Bash", { command: "ls" }), null],
    ["another event", hook("PermissionRequest", "ExitPlanMode", { plan }), null],
    ["no questions", hook("PreToolUse", "AskUserQuestion", { questions: [] }), null],
    ["not JSON", "", null],
  ])("%s", (_name, stdin, expected) => {
    expect(promptAction(stdin, "dotfiles main")).toEqual(expected);
  });
});

describe("planTitle", () => {
  test.each<[string | undefined, string]>([
    ["intro\n## Cleanup  board\n# Later", "the Cleanup board plan"],
    ["no heading", "the plan"],
    [undefined, "the plan"],
  ])("%p", (plan, expected) => {
    expect(planTitle(plan)).toBe(expected);
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

describe("hook marker path", () => {
  const Group = z.tuple([z.object({ hooks: z.tuple([z.object({ command: z.string() })]) })]);
  const Hooks = z.object({ hooks: z.object({ UserPromptSubmit: Group, Stop: Group }) });
  const hooks = async () =>
    Hooks.parse(await Bun.file(join(import.meta.dirname, "..", "hooks", "hooks.json")).json())
      .hooks;

  test("the shell fast path resolves to markerPath()", async () => {
    const { command } = (await hooks()).UserPromptSubmit[0].hooks[0];
    const [, expr] = command.match(/\[ -f (.+?) \] &&/) ?? [];
    expect(expr).toBeDefined();
    const shell = Bun.spawnSync(["sh", "-c", `printf %s ${expr}`], {
      env: { HOME: "/h", HERDR_PANE_ID: "wE5:p1", PATH: process.env.PATH },
    });
    expect(shell.stdout.toString()).toBe(markerPath("wE5:p1", "/h"));
  });

  // Stop clears a native prompt's label but leaves a review:human request,
  // which ends its turn while still waiting on the reviewer.
  test.each<[string, string | null, boolean]>([
    ["a native prompt marker", PROMPT_MARKER, true],
    ["a review:human marker", "", false],
    ["no marker", null, false],
  ])("Stop clears for %s: %p", async (_name, content, clears) => {
    const { command } = (await hooks()).Stop[0].hooks[0];
    const guard = command.slice(0, command.indexOf(" && bun "));
    const home = join(process.env.TMPDIR ?? "/tmp", `attention-${crypto.randomUUID()}`);
    if (content != null) await Bun.write(markerPath("wE5:p1", home), content);
    const shell = Bun.spawnSync(["sh", "-c", guard], {
      env: { HOME: home, HERDR_PANE_ID: "wE5:p1", PATH: process.env.PATH },
    });
    expect(shell.exitCode === 0).toBe(clears);
  });
});

describe("existingReviewr", () => {
  const tree = "/repo/one";
  const list = (panes: { pane_id: string; label?: string | null; cwd?: string }[]) =>
    JSON.stringify({ result: { panes } });

  test.each<[string, string, string | null]>([
    [
      "a labeled pane over the same tree",
      list([
        { pane_id: "wE5:p1", cwd: tree },
        { pane_id: "wE5:p4", label: "reviewr", cwd: tree },
      ]),
      "wE5:p4",
    ],
    [
      "a labeled pane over another tree",
      list([{ pane_id: "wE5:p4", label: "reviewr", cwd: "/repo/two" }]),
      null,
    ],
    ["a labeled pane with no cwd", list([{ pane_id: "wE5:p4", label: "reviewr" }]), null],
    [
      "no reviewr pane",
      list([
        { pane_id: "wE5:p1", label: null, cwd: tree },
        { pane_id: "wE5:p3", label: "Annotate", cwd: tree },
      ]),
      null,
    ],
    ["an error envelope", JSON.stringify({ error: { code: "server_unavailable" } }), null],
    ["no output", "", null],
  ])("%s", (_name, json, expected) => {
    expect(existingReviewr(json, tree)).toBe(expected);
  });
});
