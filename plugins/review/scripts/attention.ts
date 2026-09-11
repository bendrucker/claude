#!/usr/bin/env bun
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { cli, command } from "cleye";
import { z } from "zod";

// nf-fa-eye, the mark the sidebar row bound to `$review` renders.
export const reviewGlyph = String.fromCodePoint(0xf06e);

const SOURCE = "claude-review-human";
const TOKEN = "review";
const LABEL = "review";
const TTL_MS = 28_800_000;
const HERDR_TIMEOUT_MS = 5_000;
const REVIEWR_PLUGIN = "persiyanov.reviewr";
const ANNOTATE_PLUGIN = "annotate";

export function markerPath(paneId: string, home = homedir()): string {
  return join(home, ".cache", "claude", "review-human", paneId.replaceAll(":", "-"));
}

export function raiseArgs(paneId: string): string[] {
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
  } catch {
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
    return false;
  }
}

function herdrJson(args: string[]): string {
  try {
    return Bun.spawnSync(["herdr", ...args], { timeout: HERDR_TIMEOUT_MS }).stdout.toString();
  } catch {
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

const raiseCmd = command(
  {
    name: "raise",
    help: { description: "Label the pane as awaiting review and show a toast" },
    flags: {
      summary: { type: String, description: "What is up for review, shown in the toast" },
    },
  },
  async (parsed) => {
    const paneId = currentPane();
    if (paneId == null) return;
    // The marker lands first so a reply that follows the toast at once still
    // finds it and clears the label.
    const marker = markerPath(paneId);
    mkdirSync(dirname(marker), { recursive: true });
    await Bun.write(marker, "");
    herdr(raiseArgs(paneId));
    herdr(notificationArgs(parsed.flags.summary));
  },
);

const clearCmd = command(
  { name: "clear", help: { description: "Drop the review label once the review has landed" } },
  async () => {
    const paneId = currentPane();
    if (paneId == null) return;
    const marker = Bun.file(markerPath(paneId));
    if (!(await marker.exists())) return;
    // The marker outlives a failed clear so the next prompt retries it, until
    // the label's own TTL has expired it anyway.
    const expired = Date.now() - marker.lastModified > TTL_MS;
    if (herdr(clearArgs(paneId)) || expired) await marker.delete();
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
    openPane(reviewrOpenArgs(paneId));
  },
);

if (import.meta.main) {
  await cli({ name: "attention", commands: [raiseCmd, clearCmd, openCmd] }, (parsed) => {
    parsed.showHelp();
    process.exit(1);
  });
}
