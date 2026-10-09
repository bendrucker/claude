#!/usr/bin/env bun
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { cli, command } from "cleye";
import { z } from "zod";

// nf-fa-eye, the mark the sidebar row bound to `$review` renders.
export const reviewGlyph = String.fromCodePoint(0xf06e);

const SOURCE = "claude-review-human";
const TOKEN = "review";
const KIND_TOKEN = "review_kind";
const SUMMARY_TOKEN = "review_summary";
const LABEL = "review";
const TTL_MS = 28_800_000;
// A native prompt's marker holds this, so the Stop hook clears it without
// touching a review:human request, which ends its turn while still pending.
export const PROMPT_MARKER = "prompt";
const HERDR_TIMEOUT_MS = 5_000;
const REVIEWR_PLUGIN = "persiyanov.reviewr";
const ANNOTATE_PLUGIN = "annotate";

// What Ben is being asked for, read by the dotfiles cleanup board's "needs you" list.
export const kinds = ["plan", "code", "pr-body", "doc", "question"] as const;
export type Kind = (typeof kinds)[number];

export function isKind(value: string): value is Kind {
  return (kinds as readonly string[]).includes(value);
}

// herdr shows a token on one line, so a multi-line summary collapses.
export function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

const PromptHook = z.discriminatedUnion("tool_name", [
  z.object({
    hook_event_name: z.string(),
    tool_name: z.literal("ExitPlanMode"),
    tool_input: z.object({ plan: z.string().optional() }),
  }),
  z.object({
    hook_event_name: z.string(),
    tool_name: z.literal("AskUserQuestion"),
    tool_input: z.object({
      questions: z.array(z.object({ header: z.string().optional(), question: z.string() })),
    }),
  }),
]);

export type PromptAction = { clear: true } | { clear: false; kind: Kind; summary: string };

export function planTitle(plan: string | undefined): string {
  const heading = plan?.match(/^#{1,6}\s+(.+)$/m)?.[1];
  return heading == null ? "the plan" : `the ${oneLine(heading)} plan`;
}

// `place` is `<repo> <branch>`, the prefix every summary carries.
export function promptAction(stdin: string, place: string): PromptAction | null {
  let json: unknown;
  try {
    json = JSON.parse(stdin);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const parsed = PromptHook.safeParse(json);
  if (!parsed.success) return null;
  const input = parsed.data;
  if (input.hook_event_name === "PostToolUse") return { clear: true };
  if (input.hook_event_name !== "PreToolUse") return null;
  if (input.tool_name === "ExitPlanMode") {
    return {
      clear: false,
      kind: "plan",
      summary: `${place}: approve ${planTitle(input.tool_input.plan)}`,
    };
  }
  const [first, ...rest] = input.tool_input.questions;
  if (first == null) return null;
  const label = first.header == null ? first.question : `${first.header}: ${first.question}`;
  const more = rest.length > 0 ? ` (+${rest.length} more)` : "";
  return { clear: false, kind: "question", summary: `${place}: ${oneLine(label)}${more}` };
}

function gitOutput(args: string[]): string {
  try {
    return Bun.spawnSync(["git", ...args], { timeout: HERDR_TIMEOUT_MS })
      .stdout.toString()
      .trim();
  } catch {
    // A summary without the repo still names the prompt.
    return "";
  }
}

function repoBranch(): string {
  const common = gitOutput(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repo = basename(common === "" ? process.cwd() : dirname(common));
  const branch = gitOutput(["branch", "--show-current"]);
  return branch === "" ? repo : `${repo} ${branch}`;
}

export function markerPath(paneId: string, home = homedir()): string {
  return join(home, ".cache", "claude", "review-human", paneId.replaceAll(":", "-"));
}

export function raiseArgs(paneId: string, kind: Kind, summary: string): string[] {
  return [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    SOURCE,
    "--agent",
    "claude",
    "--state-label",
    `idle=${LABEL}`,
    "--state-label",
    `done=${LABEL}`,
    "--state-label",
    `working=${LABEL}`,
    "--token",
    `${TOKEN}=${reviewGlyph}`,
    "--token",
    `${KIND_TOKEN}=${kind}`,
    "--token",
    `${SUMMARY_TOKEN}=${oneLine(summary)}`,
    "--ttl-ms",
    String(TTL_MS),
  ];
}

export function clearArgs(paneId: string): string[] {
  return [
    "pane",
    "report-metadata",
    paneId,
    "--source",
    SOURCE,
    "--agent",
    "claude",
    "--clear-state-labels",
    "--clear-token",
    TOKEN,
    "--clear-token",
    KIND_TOKEN,
    "--clear-token",
    SUMMARY_TOKEN,
  ];
}

export function notificationArgs(summary: string | undefined): string[] {
  const args = ["notification", "show", "Review requested"];
  if (summary != null && summary !== "") args.push("--body", summary);
  args.push("--sound", "request");
  return args;
}

// Every surface opens as a split beside the requesting pane with focus left
// where it is. The plugins' own open actions read the focused pane from the
// invocation context, which is whatever Ben is looking at when the request
// lands, so this script names the pane itself.
function paneOpenArgs(plugin: string, entrypoint: string, paneId: string, cwd: string): string[] {
  return [
    "plugin",
    "pane",
    "open",
    "--plugin",
    plugin,
    "--entrypoint",
    entrypoint,
    "--placement",
    "split",
    "--target-pane",
    paneId,
    "--direction",
    "right",
    "--cwd",
    cwd,
    "--no-focus",
  ];
}

export function reviewrOpenArgs(paneId: string, cwd = process.cwd()): string[] {
  return paneOpenArgs(REVIEWR_PLUGIN, "pane", paneId, cwd);
}

// The doc entrypoint runs plannotator-tui, which takes the file and the pane
// to deliver into from its environment rather than from argv.
export function docOpenArgs(paneId: string, file: string): string[] {
  const path = resolve(file);
  return [
    ...paneOpenArgs(ANNOTATE_PLUGIN, "doc", paneId, dirname(path)),
    "--env",
    `PLANNOTATOR_TUI_FILE=${path}`,
    "--env",
    `PLANNOTATOR_TUI_DELIVER_TO=${paneId}`,
    "--env",
    "PLANNOTATOR_TUI_DELIVER_AGENT=claude",
  ];
}

const PaneOpened = z.object({
  result: z.object({
    plugin_pane: z.object({ pane: z.object({ pane_id: z.string() }) }),
  }),
});

const HerdrError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type OpenOutcome = { pane: string } | { error: string };

export function openedPane(stdout: string): OpenOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { error: "herdr returned no pane" };
  }
  const opened = PaneOpened.safeParse(parsed);
  if (opened.success) return { pane: opened.data.result.plugin_pane.pane.pane_id };
  const failed = HerdrError.safeParse(parsed);
  if (failed.success) return { error: failed.data.error.message };
  return { error: "herdr returned no pane" };
}

const PaneList = z.object({
  result: z.object({
    panes: z.array(
      z.object({ pane_id: z.string(), label: z.string().nullish(), cwd: z.string().nullish() }),
    ),
  }),
});

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// reviewr labels its pane on launch. A sidebar already up over the same
// working tree is re-used; one over another tree would show the wrong diff.
export function existingReviewr(paneList: string, cwd: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(paneList);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return null;
  }
  const parsed = PaneList.safeParse(json);
  if (!parsed.success) return null;
  const tree = canonical(cwd);
  return (
    parsed.data.result.panes.find(
      (pane) => pane.label === "reviewr" && pane.cwd != null && canonical(pane.cwd) === tree,
    )?.pane_id ?? null
  );
}

export function currentPane(env: Record<string, string | undefined> = process.env): string | null {
  const paneId = env.HERDR_PANE_ID;
  if (env.HERDR_ENV !== "1" || paneId == null || paneId === "") return null;
  return paneId;
}

// Attention is best effort: a herdr that is down or slow must not fail the
// skill that asked for it.
function herdr(args: string[]): boolean {
  try {
    return (
      Bun.spawnSync(["herdr", ...args], {
        timeout: HERDR_TIMEOUT_MS,
        stdio: ["ignore", "ignore", "ignore"],
      }).exitCode === 0
    );
  } catch {
    // Per the comment above: down, slow, or missing, herdr must not fail the caller.
    return false;
  }
}

function herdrJson(args: string[]): string {
  try {
    return Bun.spawnSync(["herdr", ...args], { timeout: HERDR_TIMEOUT_MS }).stdout.toString();
  } catch {
    // Per the comment above: down, slow, or missing, herdr must not fail the caller.
    return "";
  }
}

function openPane(args: string[], missingPlugin?: string): never {
  const outcome = openedPane(herdrJson(args));
  if ("error" in outcome && missingPlugin != null && outcome.error.includes("plugin not found")) {
    fail(missingPlugin);
  }
  if ("error" in outcome) fail(outcome.error);
  console.log(`opened ${outcome.pane}`);
  process.exit(0);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function raise(paneId: string, kind: Kind, summary: string, origin = ""): Promise<void> {
  // The marker lands first so a reply that follows the toast at once still
  // finds it and clears the label.
  const marker = markerPath(paneId);
  mkdirSync(dirname(marker), { recursive: true });
  await Bun.write(marker, origin);
  herdr(raiseArgs(paneId, kind, summary));
}

async function clear(paneId: string): Promise<void> {
  const marker = Bun.file(markerPath(paneId));
  if (!(await marker.exists())) return;
  // The marker outlives a failed clear so the next prompt retries it, until
  // the label's own TTL has expired it anyway.
  const expired = Date.now() - marker.lastModified > TTL_MS;
  if (herdr(clearArgs(paneId)) || expired) await marker.delete();
}

const raiseCmd = command(
  {
    name: "raise",
    help: { description: "Label the pane as awaiting review and show a toast" },
    flags: {
      kind: { type: String, description: `What Ben is asked for: ${kinds.join(", ")}` },
      summary: { type: String, description: "One line on what Ben needs to do" },
    },
  },
  async (parsed) => {
    const { kind, summary } = parsed.flags;
    if (kind == null || !isKind(kind)) fail(`--kind must be one of: ${kinds.join(", ")}`);
    if (summary == null || oneLine(summary) === "") fail("--summary is required");
    const paneId = currentPane();
    if (paneId == null) return;
    await raise(paneId, kind, summary);
    herdr(notificationArgs(summary));
  },
);

const clearCmd = command(
  { name: "clear", help: { description: "Drop the review label once the review has landed" } },
  async () => {
    const paneId = currentPane();
    if (paneId == null) return;
    await clear(paneId);
  },
);

const promptCmd = command(
  {
    name: "prompt",
    help: {
      description: "Hook entry: raise plan or question for a native prompt, clear once answered",
    },
  },
  async () => {
    const paneId = currentPane();
    if (paneId == null) return;
    const action = promptAction(await Bun.stdin.text(), repoBranch());
    if (action == null) return;
    await (action.clear
      ? clear(paneId)
      : raise(paneId, action.kind, action.summary, PROMPT_MARKER));
  },
);

const openCmd = command(
  {
    name: "open",
    help: { description: "Open a review surface beside this pane, delivering into it" },
    flags: {
      diff: { type: Boolean, description: "Open reviewr over the working diff" },
      doc: { type: String, description: "Open plannotator-tui over this file" },
    },
  },
  async (parsed) => {
    if (!parsed.flags.diff && parsed.flags.doc == null) {
      parsed.showHelp();
      process.exit(1);
    }
    const paneId =
      currentPane() ?? fail("not inside a herdr pane (HERDR_PANE_ID unset): use --browser");
    if (parsed.flags.doc != null) {
      if (!(await Bun.file(parsed.flags.doc).exists())) fail(`no such file: ${parsed.flags.doc}`);
      openPane(
        docOpenArgs(paneId, parsed.flags.doc),
        `plannotator-tui not found: install the \`${ANNOTATE_PLUGIN}\` herdr plugin`,
      );
    }
    const workspace = process.env.HERDR_WORKSPACE_ID;
    const open =
      workspace == null
        ? null
        : existingReviewr(herdrJson(["pane", "list", "--workspace", workspace]), process.cwd());
    if (open != null) {
      console.log(`reviewr already open (${open})`);
      process.exit(0);
    }
    openPane(
      reviewrOpenArgs(paneId),
      `reviewr not found: install the \`${REVIEWR_PLUGIN}\` herdr plugin`,
    );
  },
);

if (import.meta.main) {
  await cli({ name: "attention", commands: [raiseCmd, clearCmd, promptCmd, openCmd] }, (parsed) => {
    parsed.showHelp();
    process.exit(1);
  });
}
