# Style

Code style enforcement hooks.

## Contents

- **Hooks**: Numbering detection and heading style enforcement for Write and Edit tools

## Hook Commands

Each hook command runs `bun install --cwd ${CLAUDE_PLUGIN_ROOT}` before the hook script. Installed plugins have no `node_modules` — bun auto-installs dependencies from its global cache, but packages like `unist-util-visit-parents` use self-referencing subpath exports that fail without a local `node_modules`. Running `bun install` ensures Node.js-style resolution works. With everything already installed, `bun install` completes in ~50ms.

## Testing

```sh
bun test plugins/style
```
