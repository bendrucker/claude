# Magic Numbers

Flag unexplained numeric literals in changed lines. A magic number is a bare numeric constant whose meaning is not obvious from context.

## What to Flag

- Numeric literals used in comparisons, thresholds, or configuration (e.g., `if retries > 3`, `timeout: 30000`)
- Array indices beyond 0 (e.g., `parts[2]`)
- Bitwise masks and shift amounts (e.g., `flags & 0x1F`)
- Repeated identical literals across the diff

## What to Skip

- **0 and 1** in common idioms (loop init, increment, empty check)
- **HTTP status codes** (200, 201, 204, 301, 400, 401, 403, 404, 500) when used with HTTP context
- **Exit codes** (0, 1) in process exit calls
- **Math constants** (100 for percentages, 1000 for ms conversion) when the intent is clear from context
- **Test assertions** where the literal is the expected value being verified
- **Enum-like definitions** — the constant is being named, not used anonymously

## Suggesting Fixes

Suggest extracting to a named constant that explains the value's purpose:

```
const maxRetries = 3;
if (retries > maxRetries) { ... }
```

For Go, suggest package-level constants. For Python, suggest module-level constants. Match the project's existing naming convention.

## Severity

Magic numbers are a **Style** concern. Use `Nit:` prefix for isolated cases. Escalate to **Should** when multiple unexplained literals appear in the same function or when the value is non-obvious (e.g., `if size > 8192`).
