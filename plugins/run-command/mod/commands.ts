const DIGIT = /^[1-9]$/;
export const LIMIT = 9;

// A line that is only `! <command>`, optionally bulleted or in backticks.
const COMMAND = /^\s*(?:[-*]\s+)?`?!\s+([^`]+?)\s*`?\s*$/;
// Operators holding an `&` that still chain: `&&` and fd redirects.
const CHAINING_AMPERSANDS = /&&|[<>]&|&>/g;

/** Blank lines and code fences sit between commands without ending their block. */
function keepsBlock(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("```");
}

/**
 * `;` would mask an earlier failure, `#` comments out the rest of the chain,
 * and a lone `&` backgrounds.
 */
function chainable(command: string): boolean {
  return !/[;#&]/.test(command.replace(CHAINING_AMPERSANDS, ""));
}

/** A reply's commands, grouped into runs that only blank lines and fences separate. */
export function blocks(text: string): string[][] {
  const found: string[][] = [];
  let open = false;
  for (const line of text.split("\n")) {
    const command = COMMAND.exec(line)?.[1];
    if (command !== undefined) {
      if (open) found.at(-1)?.push(command);
      else found.push([command]);
      open = true;
    } else if (!keepsBlock(line)) {
      open = false;
    }
  }
  return found;
}

export function commands(text: string): string[] {
  return blocks(text).flat();
}

/** Joins a block with `&&` so it stops at the first failure, if each command chains safely. */
export function chain(block: readonly string[]): string | undefined {
  if (block.length < 2 || !block.every(chainable)) return undefined;
  return block.join(" && ");
}

export interface RunAll {
  first: number;
  count: number;
  command: string;
}

/** Each chainable block among the listed commands, by its 1-based list positions. */
export function runAlls(found: readonly string[][]): RunAll[] {
  const runs: RunAll[] = [];
  let first = 1;
  for (const block of found) {
    const listed = block.slice(0, Math.max(0, LIMIT - first + 1));
    const command = chain(listed);
    if (command !== undefined) runs.push({ first, count: listed.length, command });
    first += block.length;
  }
  return runs;
}

export function pick(inputText: string, found: readonly string[]): string | undefined {
  return DIGIT.test(inputText) ? found[Number(inputText) - 1] : undefined;
}
