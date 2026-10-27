import type { Root } from "mdast";

interface Markdown {
  fromMarkdown: (value: string) => Root;
  visit: typeof import("unist-util-visit").visit;
}

let pending: Promise<Markdown> | undefined;

// The markdown parser and its tree walker cost about 25ms to load, the largest
// single entry in the PreToolUse dispatcher's module graph. The checkers that
// use them sit behind a markdown-extension test, so a static import spends that
// 25ms on every fire against a code file, a data file, or a Bash command, none
// of which can reach a parse. Resolving inside the parse is the only way to put
// a runtime-conditional graph behind a runtime condition.
//
// The promise is memoized, so several parses in one run share one resolution.
// Measured against the static import it costs roughly 3ms when a parse does
// happen, and saves the full 25ms when none does.
export function loadMarkdown(): Promise<Markdown> {
  pending ??= Promise.all([import("mdast-util-from-markdown"), import("unist-util-visit")]).then(
    ([{ fromMarkdown }, { visit }]) => ({ fromMarkdown, visit }),
  );
  return pending;
}
