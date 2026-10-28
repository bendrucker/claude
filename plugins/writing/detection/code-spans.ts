const FENCED_CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;

/** Blank out fenced blocks and inline code, keeping every line and column in place. */
export function stripCode(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK, (block) => "\n".repeat(block.split("\n").length - 1))
    .replace(INLINE_CODE, (code) => " ".repeat(code.length));
}
