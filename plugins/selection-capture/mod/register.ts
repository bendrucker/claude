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

async function hasThings($: EngineInterface): Promise<boolean> {
  try {
    const { exitCode } = await $.process.run(["open", "-Ra", "Things3"]);
    return exitCode === 0;
  } catch {
    // `open` cannot start off macOS or off the CLI, where Things is absent anyway.
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

async function capture(
  $: EngineInterface,
  target: Target,
  args: string,
): Promise<CommandRunResult> {
  const selected = await $.ui.selection();
  if (selected === undefined || selected.text.trim() === "") {
    return {
      text: "Nothing selected. Select transcript text with the mouse (fullscreen mode), then run the command.",
    };
  }
  const quoted = quote(selected.text);
  const draft: Capture = {
    title: title(args, selected.text),
    quote: quoted,
    row: row(selected, await $.session.messages()),
    launch: launchUrl(await $.session.id(), quoted, await repoOf($)),
  };
  const url = targetUrl(target, draft);
  const argv = target === "things" ? ["open", "-g", url] : ["open", url];
  try {
    const { exitCode, stderr } = await $.process.run(argv);
    if (exitCode !== 0) throw new Error(stderr.trim());
  } catch (error) {
    $.ui.log(`${target} capture failed to open: ${String(error)}`, { to: "debug" });
    return {
      text: `Could not open the ${NAMES[target]}. Its contents:\n\n# ${draft.title}\n\n${body(draft)}`,
    };
  }
  $.ui.toast(`${NAMES[target]}: ${draft.title}`);
  return { text: `${NAMES[target]}: ${draft.title}` };
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
    if (await hasThings($)) {
      served.set((await $.command.register(COMMANDS.things)).command, "things");
    }
    served.set((await $.command.register(COMMANDS.linear)).command, "linear");
    return result;
  });

  on("command.run", ($, e, next) => {
    const target = served.get(e.command);
    return target === undefined ? next(e) : capture($, target, e.args);
  });
}
