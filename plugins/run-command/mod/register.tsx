import type { ButtonProps, On, RenderElement } from "claude-code";
import { blocks, LIMIT, pick, runAlls, type RunAll } from "./commands.ts";

const MOD = "run-command";
const KEY = "run-command:";
/** The command a button's key carries, read back when it is pressed. */
export function pressed(element: string): string | undefined {
  if (!element.startsWith(KEY)) return undefined;
  const rest = element.slice(KEY.length);
  return rest.slice(rest.indexOf(":") + 1);
}

// onPress is a no-op. The ui.press hook does the fill, since only a hook has `$`.
function commandButtons(
  Button: (props: ButtonProps) => RenderElement,
  found: readonly string[],
  props: (command: string, index: number) => Partial<ButtonProps>,
): RenderElement[] {
  return found.map((command, index) => (
    <Button
      key={`${KEY}${index}:${command}`}
      plain
      label={command}
      onPress={() => undefined}
      {...props(command, index)}
    />
  ));
}

/**
 * Offers the `! <command>` lines of a reply once the person types `!`: a
 * button under the reply and a numbered list above the prompt, each filling
 * the command into the shell prompt. A digit in the empty shell prompt picks
 * from the list.
 */
export function register(on: On): void {
  // prompt.read and prompt.edit never show bash mode, so it is read off the
  // hint line, which says "! for shell mode" while the empty prompt is in it.
  let shell = false;
  // A redraw repaints older replies too, so only a reply drawn for the first
  // time, or the latest one again, moves the list.
  const seen = new Set<string>();
  let latest = { requestId: "", found: [] as string[], runs: [] as RunAll[] };
  let listed = false;
  // The band redraws often, so each reply's list counts as shown once.
  let shownFor: string | undefined;

  on("session.start", async ($, e, next) => {
    const started = await next(e);
    void $.modEvents.emit({ mod: MOD, event: "session.start" });
    return started;
  });

  on("ui.render", { component: "PromptHint" }, ($, e, next) => {
    const now = e.props.hint.includes("shell mode") && !e.props.isDraft;
    if (now !== shell) {
      shell = now;
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    const drawing = await next(e);
    const grouped = blocks(e.props.text);
    const found = grouped.flat();
    const parsed = { requestId: e.requestId, found, runs: runAlls(grouped) };
    // A reply with no commands still clears the list, but a later block of the
    // latest reply without any keeps the ones an earlier block offered.
    if (!seen.has(e.requestId)) {
      seen.add(e.requestId);
      latest = parsed;
    } else if (e.requestId === latest.requestId && found.length > 0) {
      latest = parsed;
    }
    if (!shell || found.length === 0) return drawing;
    const { Box, Button } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {drawing}
        <Box flexDirection="column" marginLeft={2}>
          {commandButtons(Button, found, (command) => ({ dimColor: true, label: `▸ ${command}` }))}
        </Box>
      </Box>
    );
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const drawing = await next(e);
    const found = latest.found.slice(0, LIMIT);
    listed = shell && !e.props.hasSurvey && found.length > 0;
    if (!listed) {
      shownFor = undefined;
      return drawing;
    }
    if (shownFor !== latest.requestId) {
      shownFor = latest.requestId;
      void $.modEvents.emit({ mod: MOD, event: "list.shown", detail: { count: found.length } });
    }
    const { Box, Button } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {drawing}
        {commandButtons(Button, found, (command, index) => ({ hotkey: String(index + 1) }))}
        {latest.runs.map((run, index) => (
          <Button
            key={`${KEY}all${index}:${run.command}`}
            plain
            label={`run all ${run.first}–${run.first + run.count - 1}`}
            onPress={() => undefined}
            {...(index === 0 ? { hotkey: "0" } : {})}
          />
        ))}
      </Box>
    );
  });

  // The list's hotkeys stay inert while the shell prompt holds the keys.
  on("prompt.edit", ($, e, next) => {
    if (!listed || e.text !== "") return next(e);
    const run = e.inputText === "0" ? latest.runs[0] : undefined;
    if (run !== undefined) {
      const detail = { count: run.count, source: "digit" };
      void $.modEvents.emit({ mod: MOD, event: "pick.all", detail });
      return next({ ...e, inputText: run.command });
    }
    const command = pick(e.inputText, latest.found);
    if (command === undefined) return next(e);
    void $.modEvents.emit({ mod: MOD, event: "pick", detail: { command, source: "digit" } });
    return next({ ...e, inputText: command });
  });

  on("ui.press", { plugin: "run-command" }, async ($, e, next) => {
    const command = pressed(e.element);
    if (command === undefined) return next(e);
    const run = e.element.startsWith(`${KEY}all`)
      ? latest.runs.find((candidate) => candidate.command === command)
      : undefined;
    if (run !== undefined) {
      const detail = { count: run.count, source: "click" };
      void $.modEvents.emit({ mod: MOD, event: "pick.all", detail });
    } else {
      void $.modEvents.emit({ mod: MOD, event: "pick", detail: { command, source: "click" } });
    }
    await $.prompt.fill({ text: command, mode: "insert" });
    return { element: e.element };
  });
}
