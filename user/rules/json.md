---
paths:
  - "**/*.json"
---

# JSON

- ALWAYS use `jq` for producing JSON output to ensure validity.
- Use `jq` to parse JSON input. If you know the structure, use `jq` filters to extract specific fields. JSON is often token-heavy, so optimize for size.
  - Use `jq` filters like `keys`, `type`, and length to inspect JSON structures.
  - When fetching from the internet, output JSON to temporary files in `tmp/` directory to allow for inspection.
- The Bash tool escapes `!` to `\!` on every path (heredocs included), breaking jq `!=`. Use `| not` instead (e.g., `select(.x == null | not)`). For a filter that needs a literal `!`, write it to a `.jq` file with the Write tool and run `jq -f`.
