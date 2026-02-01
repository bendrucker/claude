# Testing

Bun's test runner executes all tests in a single process, not worker-per-file like Vitest or Jest.

## Key Flags

| Flag | Description |
|------|-------------|
| `--bail` / `--bail=N` | Stop after N failures (default: 1) |
| `-t` / `--test-name-pattern` | Filter by name (regex, not globs) |

## Agent Output

Set `AGENT=1` to suppress passing test output while preserving failure details:

```bash
AGENT=1 bun test
```
