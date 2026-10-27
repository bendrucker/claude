---
fail: []
---
| Case | Top lead | Share |
| --- | --- | ---: |
| filter | `parse_amount` (48 `strtod` calls per row) | 85.0% |
| group | `group_lookup` linear scan | 97.5% |
| sort | `compare_rows` formatting keys with `snprintf` | 93.2% |
| dedupe | `seen_insert` memmove | 97.4% |
