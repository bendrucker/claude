---
type: regex
target:
  source: file
  path: tests/test_pages.py
pattern: 'paginate\('
match: contains
---
A test exercises `paginate` directly.
