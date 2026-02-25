# Log Parsing Patterns

Language-agnostic strategies for extracting failure details from CI logs.

## General Strategy

Search from the **bottom of the log upward** — failure summaries are almost always at the end. Use `tail` to get the last N lines as a fallback when no structured pattern matches.

## By Framework

### Python (pytest)

- Look for `= FAILURES =` or `= short test summary info =` sections (between `═══` delimiter lines)
- With pytest-xdist, parallel output interleaves but the summary section is always consolidated at the end
- For doc/example tests, look for diff output between `--- before` and `+++ after`

### Go

- Look for `--- FAIL:` lines and subsequent output until the next `---` or `FAIL` line
- `go build` errors: `file.go:line:col: error message`

### Node (Jest / Vitest)

- Look for `FAIL` prefix lines, assertion errors, or `Expected`/`Received` blocks
- Summary section starts with `Tests:` showing pass/fail counts

### Rust

- Look for `error[E####]:` lines with file:line references
- Test failures: `---- test_name stdout ----` sections

### Build / Lint Errors

- Look for `error:`, `Error:`, `FATAL`, or non-zero exit codes
- Compiler errors typically include `file:line:col` references

### Diff Output

For tests that compare expected vs actual output:
- Unified diff markers: `---`, `+++`, `@@`
- Inline diff: `-expected` / `+actual` lines
