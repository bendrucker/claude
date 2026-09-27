import type { ButtonProps, On, RenderElement } from "claude-code";

const KEY = "run-command:";
const DIGIT = /^[1-9]$/;

// A line that is only `! <command>`, optionally bulleted or in backticks.
const COMMAND = /^\s*(?:[-*]\s+)?`?!\s+([^`]+?)\s*`?\s*$/;

export function commands(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const command = COMMAND.exec(line)?.[1];
    if (command !== undefined) found.push(command);
  }
  return found;
}

export function pick(inputText: string, found: readonly string[]): string | undefined {
  return DIGIT.test(inputText) ? found[Number(inputText) - 1] : undefined;
}

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
  let latest = { requestId: "", found: [] as string[] };

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
    const found = commands(e.props.text);
    // A reply with no commands still clears the list, but a later block of the
    // latest reply without any keeps the ones an earlier block offered.
    if (!seen.has(e.requestId)) {
      seen.add(e.requestId);
      latest = { requestId: e.requestId, found };
    } else if (e.requestId === latest.requestId && found.length > 0) {
      latest = { requestId: e.requestId, found };
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
    const found = latest.found.slice(0, 9);
    if (!shell || e.props.hasSurvey || found.length === 0) return drawing;
    const { Box, Button } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {drawing}
        {commandButtons(Button, found, (command, index) => ({ hotkey: String(index + 1) }))}
      </Box>
    );
  });

  // The list's hotkeys stay inert while the shell prompt holds the keys.
  on("prompt.edit", ($, e, next) => {
    const command = shell && e.text === "" ? pick(e.inputText, latest.found) : undefined;
    return next(command === undefined ? e : { ...e, inputText: command });
  });

  on("ui.press", { plugin: "run-command" }, async ($, e, next) => {
    const command = pressed(e.element);
    if (command === undefined) return next(e);
    await $.prompt.fill({ text: command, mode: "insert" });
    return { element: e.element };
  });
}
