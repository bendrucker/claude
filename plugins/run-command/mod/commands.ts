const DIGIT = /^[1-9]$/;
export const LIMIT = 9;

// A line that is only `! <command>`, optionally bulleted or in backticks.
const COMMAND = /^\s*(?:[-*]\s+)?`?!\s+([^`\s][^`]*?)\s*`?\s*$/;
// Operators holding an `&` that still chain: `&&` and fd redirects.
const CHAINING_AMPERSANDS = /&&|[<>]&|&>/g;
// A sourced script runs in this shell, where a chain switches off its `set -e`.
const SOURCES = /(?:^|&&|\|)\s*(?:source|\.)(?:\s|$)/;

/** Blank lines and code fences sit between commands without ending their block. */
function keepsBlock(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("```");
}

/**
 * `;` would mask an earlier failure, `||` would run after one, `#` comments
 * out the rest of the chain, and a lone `&` backgrounds.
 */
function chainable(command: string): boolean {
  const bare = unquoted(command);
  return (
    bare !== undefined &&
    !/(?:\||&&)$/.test(bare) &&
    !/(?<!<)<<(?!<)/.test(bare) &&
    !bare.includes("||") &&
    !SOURCES.test(bare) &&
    !/[;#&]/.test(bare.replaceAll(CHAINING_AMPERSANDS, ""))
  );
}

/**
 * The command with each quoted or escaped span replaced by `_`, or undefined
 * when a quote, escape, or paren is left open and would swallow the ` && `
 * after it. A substitution inside double quotes is refused, since tracking
 * its own quotes would take a full parser.
 */
function unquoted(command: string): string | undefined {
  let bare = "";
  let quote: string | undefined;
  let depth = 0;
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") [quote, bare] = [undefined, `${bare}_`];
    } else if (char === "\\") {
      if (++i === command.length) return undefined;
      if (quote === undefined) bare += "_";
    } else if (quote !== undefined) {
      if (char === quote.at(-1)) [quote, bare] = [undefined, `${bare}_`];
      else if (quote === '"' && (char === "`" || (char === "$" && command[i + 1] === "(")))
        return undefined;
    } else if (char === "$" && command[i + 1] === "'") {
      [quote, i] = ["$'", i + 1];
    } else if (char === "'" || char === '"') {
      quote = char;
    } else {
      if (char === "(") depth++;
      if (char === ")" && --depth < 0) return undefined;
      bare += char;
    }
  }
  return quote === undefined && depth === 0 ? bare : undefined;
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
