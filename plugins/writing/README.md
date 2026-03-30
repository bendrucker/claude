# Writing

Writing style enforcement hooks and AI trope detection.

## Contents

- **Hooks**: Numbered heading detection, heading style enforcement, AI writing trope detection (em dashes, vocabulary, copula avoidance, promotional language, parallelism, semicolons)
- **Skills**: `writing` system reminder for prose writing guidelines

## Hook Commands

Each existing hook command runs `bun install --cwd ${CLAUDE_PLUGIN_ROOT}` before the hook script. Installed plugins have no `node_modules` — bun auto-installs dependencies from its global cache, but packages like `unist-util-visit-parents` use self-referencing subpath exports that fail without a local `node_modules`. Running `bun install` ensures Node.js-style resolution works. With everything already installed, `bun install` completes in ~50ms.

The `check-tropes.ts` hook does not need `bun install` since it has no dependencies requiring local resolution.

## Testing

```sh
bun test plugins/writing
```
