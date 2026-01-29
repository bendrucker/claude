# Type Ignore

Detects and eliminates type ignores across your codebase.

## Contents

- **Skills**
  - `fix` — Discovers and fixes type ignores across files, directories, or codebase

- **Hooks**
  - `detect.ts` — PostToolUse hook that detects new type/lint ignores in edits

- **Agents**
  - `fixer` — Fixes type errors in a single file (spawned by hook or skill)

## Patterns Detected

- TypeScript/JavaScript: `@ts-ignore`, `@ts-expect-error`, `eslint-disable[-next-line]`, `biome-ignore`
- Python: `# type: ignore`, `# noqa`, `# pylint: disable`
- Go: `//nolint`, `//lint:ignore`
- Rust: `#[allow(...)]`
- Ruby: `# rubocop:disable`

## Usage

The fixer agent runs automatically when Claude adds a type ignore.

For broader cleanup, use the `/fix` skill:

- **Directory**: `/type-ignore:fix src/`
- **Codebase-wide**: `/type-ignore:fix`

The skill discovers files with ignores and spawns parallel fixer agents. When unable to fix an ignore, agents replace it with a TODO comment explaining why.

## Testing

```bash
npm test -- plugins/type-ignore
```
