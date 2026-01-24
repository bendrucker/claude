# Type Ignore

Detects and eliminates type ignores across your codebase.

## Contents

- **Hooks**
  - `detect.ts` — PostToolUse hook that detects new type/lint ignores in edits
  - `commit-todos.ts` — PostToolUse hook that warns about new TODOs in commits

- **Agents**
  - `fixer` — Fixes type errors instead of ignoring them

## Patterns Detected

- TypeScript: `@ts-ignore`, `@ts-expect-error`, `eslint-disable[-next-line]`
- Python: `# type: ignore`, `# noqa`

## Usage

The fixer agent runs automatically when Claude adds a type ignore. You can also invoke it directly:

- **Single file**: "Run type-ignore:fixer on src/utils.ts"
- **Directory**: "Run type-ignore:fixer on all files in src/"
- **Codebase-wide**: "Run type-ignore:fixer across the codebase"

When unable to fix an ignore, the agent replaces it with a TODO comment explaining why.

## Testing

```bash
npm test -- plugins/type-ignore
```
