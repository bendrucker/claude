---
fail: [dedupe, filter, sort]
---
| Case | Top lead | Share |
| --- | --- | ---: |
| filter | `os_unfair_lock_lock` | 12.1% |
| group | `group_lookup` | 97.5% |
| sort | `_platform_memmove` | 9.6% |
| dedupe | `_platform_memmove` | 96.0% |
