# Writing

Writing style enforcement hooks and AI trope detection.

## Contents

- **Hooks**: Numbered heading detection, heading style enforcement, AI writing trope detection (em dashes, vocabulary, copula avoidance, promotional language, parallelism, semicolons)
- **Skills**: `writing` system reminder for prose writing guidelines, `writing:review` multi-agent document review
- **Agents**: `content`, `style`, `artifacts` (conditional review lenses)

## Wordlists

Trope patterns that take the form of a list of words live as line-delimited files under [`wordlists/`](wordlists/).

#### Plain wordlists

One entry per line. Each entry compiles to a `\b...\b` regex fragment. Entries support a suffix-group syntax: `meticulous(ly)` becomes `meticulous(?:ly)?`, `underscore(s|d)` becomes `underscore(?:s|d)?`. `#` comments and blank lines are ignored.

#### Weighted wordlists

`<entry> <weight>` per line. The hook accumulates the weighted total of hits and reminds when the total clears a threshold.

The loader lives in [`hooks/wordlists.ts`](hooks/wordlists.ts). Compiled patterns are exposed via the `WORDLISTS` constant and consumed by `tropes.ts`.

## Hook Commands

Each existing hook command runs `bun install --cwd ${CLAUDE_PLUGIN_ROOT}` before the hook script. Installed plugins have no `node_modules` — bun auto-installs dependencies from its global cache, but packages like `unist-util-visit-parents` use self-referencing subpath exports that fail without a local `node_modules`. Running `bun install` ensures Node.js-style resolution works. With everything already installed, `bun install` completes in ~50ms.

The `check-tropes.ts` hook does not need `bun install` since it has no dependencies requiring local resolution.

## Testing

```sh
bun test plugins/writing
```
