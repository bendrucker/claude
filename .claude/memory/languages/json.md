# JSON

- ALWAYS use `jq` for any JSON output. DO NOT use heredocs or other methods to format JSON.
- Use `jq` to parse JSON input. If you know the structure, use `jq` filters to extract specific fields. JSON is often token-heavy, so optimizing for size is important.
  - Use `jq` filters like `keys`, `type`, and length to inspect JSON structures.
  - When fetching from the internet, output JSON to temporary files in `tmp/` directory to allow for inspection.
