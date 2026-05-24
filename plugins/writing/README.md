# Writing

Writing style enforcement and slop detection for prose output (PR descriptions, review comments, Slack messages, documentation). Catches AI-generated and human writing patterns that read as vague, promotional, or templated.

## Contents

- **Hooks**: Numbered heading detection, heading style enforcement, AI writing trope detection (em dashes, vocabulary, copula avoidance, promotional language, parallelism, semicolons)
- **Skills**: `writing` system reminder for prose writing guidelines, `writing:review` multi-agent document review
- **Agents**: `content`, `style`, `artifacts` (conditional review lenses)

## Wordlists

Trope patterns that take the form of a list of words live as line-delimited files under [`wordlists/`](wordlists/).

#### Stemmed Wordlists

One word per line. Matching uses a Porter stemmer (`stemmer` npm package), so inflected forms are caught automatically from base entries. `#` comments and blank lines are ignored. Multi-word and hyphenated phrases are not supported in stemmed wordlists (the stemmer tokenizes on word boundaries). Use inline regex patterns in `tropes.ts` for phrase matching.

#### Plain Wordlists (Regex)

Used for openers and let-me-verbs where the match depends on position context (line start, "let me" prefix). One entry per line, compiled to a regex alternation with configurable prefix/suffix.

#### Weighted Wordlists

`<word> <weight>` per line. Uses the same Porter stemmer as vocabulary. The hook accumulates the weighted total of hits and reminds when the total clears a threshold.

The loader lives in [`hooks/wordlists.ts`](hooks/wordlists.ts). Compiled patterns are exposed via the `WORDLISTS` constant and consumed by `tropes.ts`.

## Hook Commands

Each existing hook command runs `bun install --cwd ${CLAUDE_PLUGIN_ROOT}` before the hook script. Installed plugins have no `node_modules` — bun auto-installs dependencies from its global cache, but packages like `unist-util-visit-parents` use self-referencing subpath exports that fail without a local `node_modules`. Running `bun install` ensures Node.js-style resolution works. With everything already installed, `bun install` completes in ~50ms.

The `check-tropes.ts` hook does not need `bun install` since it has no dependencies requiring local resolution.

## Testing

```sh
bun test plugins/writing
```
