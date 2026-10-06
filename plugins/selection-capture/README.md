# Selection Capture

Capture text you selected in the transcript as a Things to-do or a Linear issue draft.

## Contents

- **Mod**: [`register.ts`](mod/register.ts) adds `/things [title]` and `/linear [title]`. Each one quotes the mouse selection and the transcript row it lies in (the tool call, or the message holding the text), then adds a `claude-cli://` link that opens a new Claude Code session in the main checkout.
  - `/things` opens `things:///add` in the background, tagged `claude`. It is registered only when Things 3 is installed.
  - `/linear` opens a prefilled `linear.new` issue in the browser for you to finish and submit.
  - Without a title argument, the selection's first line becomes the title. When `open` fails, the command prints the capture instead.
- **Events**: through [`mod-events`](../mod-events/README.md), a `session.start` event noting whether `/things` registered, and one `capture` event per run with its target, outcome (`opened`, `no-selection`, `open-failed`, `error`), the row it found, and the selection's length. The selected text is never logged.

## Setup

- Requires the `mod-events` plugin. Function hooks are early access. Set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` to load the mod.
- `$.ui.selection()` sees a selection only in fullscreen mode. Select text with the mouse, then run the command.
- macOS only, since captures open through `open`.

## Tests

`claude plugin test plugins/selection-capture` runs the mod's tests.
