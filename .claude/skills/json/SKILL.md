---
name: json
description: JSON processing and handling best practices using jq. Use when working with JSON data, parsing JSON files, generating JSON output, or processing JSON from APIs.
---
# JSON

- ALWAYS use `jq` for producing JSON output to ensure validity.
- Use `jq` to parse JSON input. If you know the structure, use `jq` filters to extract specific fields. JSON is often token-heavy, so optimizing for size is important.
  - Use `jq` filters like `keys`, `type`, and length to inspect JSON structures.
  - When fetching from the internet, output JSON to temporary files in `tmp/` directory to allow for inspection.
