import { styleText as styleTextForStream } from "node:util";

// Claude Code always pipes the statusline, so stdout is never a TTY and Bun
// 1.4.0's styleText drops color on its own. The client renders the escape
// codes, so opt out of stream detection instead of gating on FORCE_COLOR,
// which every process the statusline spawns would inherit.
export function styleText(format: Parameters<typeof styleTextForStream>[0], text: string): string {
  return styleTextForStream(format, text, { validateStream: false });
}
