import type { CommandRunResult, EngineInterface, On } from "claude-code";
import {
  type Capture,
  type Target,
  body,
  launchUrl,
  mainRepo,
  quote,
  row,
  targetUrl,
  title,
} from "./capture.ts";

const COMMANDS = {
  things: {
    name: "things",
    description: "Capture the selected text as a Things to-do",
    argumentHint: "[title]",
  },
  linear: {
    name: "linear",
    description: "Draft a Linear issue from the selected text",
    argumentHint: "[title]",
  },
} as const;

const NAMES: Record<Target, string> = { things: "Things to-do", linear: "Linear draft" };

const THINGS_BUNDLE = "com.culturedcode.ThingsMac";

async function hasThings($: EngineInterface): Promise<boolean> {
  try {
    const { exitCode, stdout } = await $.process.run([
      "mdfind",
      `kMDItemCFBundleIdentifier == '${THINGS_BUNDLE}'`,
    ]);
    return exitCode === 0 && stdout.trim() !== "";
  } catch {
    // `mdfind` cannot start off macOS or off the CLI, where Things is absent anyway.
    return false;
  }
}

async function repoOf($: EngineInterface): Promise<string> {
  const root = await $.session.root();
  try {
    const { exitCode, stdout } = await $.process.run(
      ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root },
    );
    return exitCode === 0 ? mainRepo(stdout, root) : root;
  } catch {
    return root;
  }
}

const MOD = "selection-capture";

type Outcome = "opened" | "no-selection" | "open-failed" | "error";

async function capture(
  $: EngineInterface,
  target: Target,
  args: string,
): Promise<CommandRunResult> {
  const started = Date.now();
  const selected = await $.ui.selection();
  if (selected === undefined || selected.text.trim() === "") {
    record($, target, "no-selection", started, {});
    return {
      text: "Nothing selected. Select transcript text with the mouse (fullscreen mode), then run the command.",
    };
  }
  const quoted = quote(selected.text);
  const [messages, sessionId, repo] = await Promise.all([
    $.session.messages(),
    $.session.id(),
    repoOf($),
  ]);
  const draft: Capture = {
    title: title(args, selected.text),
    quote: quoted,
    row: row(selected, messages),
    launch: launchUrl(sessionId, quoted, repo),
  };
  const detail = {
    chars: selected.text.length,
    row: draft.row?.label ?? null,
    titled: args.trim() !== "",
  };
  const url = targetUrl(target, draft);
  const argv = target === "things" ? ["open", "-g", url] : ["open", url];
  let failure: string | undefined;
  try {
    const { exitCode, stderr } = await $.process.run(argv);
    if (exitCode !== 0) failure = `open exited ${exitCode}: ${stderr.trim()}`;
  } catch (error) {
    failure = `open did not start: ${String(error)}`;
  }
  if (failure !== undefined) {
    $.ui.log(`${target} capture failed: ${failure}`, { to: "debug" });
    record($, target, "open-failed", started, { ...detail, error: failure });
    return {
      text: `Could not open the ${NAMES[target]}. Its contents:\n\n# ${draft.title}\n\n${body(draft)}`,
    };
  }
  record($, target, "opened", started, detail);
  $.ui.toast(`${NAMES[target]}: ${draft.title}`);
  return { text: `${NAMES[target]}: ${draft.title}` };
}

async function guarded(
  $: EngineInterface,
  target: Target,
  args: string,
): Promise<CommandRunResult> {
  const started = Date.now();
  try {
    return await capture($, target, args);
  } catch (error) {
    record($, target, "error", started, { error: String(error) });
    return { text: `Could not capture the ${NAMES[target]}: ${String(error)}` };
  }
}

function record(
  $: EngineInterface,
  target: Target,
  outcome: Outcome,
  started: number,
  detail: Record<string, unknown>,
): void {
  void $.modEvents.emit({
    mod: MOD,
    event: "capture",
    ok: outcome === "opened",
    ms: Date.now() - started,
    detail: { target, outcome, ...detail },
  });
}

/**
 * Registers `/things` and `/linear`, which turn the mouse selection and its
 * transcript row into a Things to-do or a prefilled Linear issue, each linking
 * back to a new Claude Code session in the main checkout.
 */
export function register(on: On): void {
  const served = new Map<string, Target>();

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    const things = await hasThings($);
    if (things) {
      served.set((await $.command.register(COMMANDS.things)).command, "things");
    }
    served.set((await $.command.register(COMMANDS.linear)).command, "linear");
    void $.modEvents.emit({ mod: MOD, event: "session.start", detail: { things } });
    return result;
  });

  on("command.run", ($, e, next) => {
    const target = served.get(e.command);
    return target === undefined ? next(e) : guarded($, target, e.args);
  }).catch(($, e, next) =>
    next.called ? next(e) : { text: `Could not capture the selection for /${e.command}.` },
  );
}
