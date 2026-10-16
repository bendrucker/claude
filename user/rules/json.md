---
paths:
  - "**/*.json"
---

# JSON

- ALWAYS use `jq` for producing JSON output to ensure validity.
- Use `jq` to parse JSON input, extracting specific fields when the structure is known.
- When fetching JSON from the internet, write it to a file in `tmp/` so it can be inspected.
