---
paths:
  - "**/*.py"
---

# Python

- Use the newest language features the project's minimum supported version allows.
- Before answering a standard library question, `WebFetch` `https://docs.python.org/3/library/<module>.html` instead of answering from memory.

## Type Hints

- Use specific types, `TypeVar`, or protocols instead of `Any`.
- Use `# type: ignore` only in rare cases in test code.
- When the minimum version is below 3.14, add `from __future__ import annotations`.

## Tests

- Write table-driven tests with `pytest.mark.parametrize`.
- Annotate test functions `-> None`.
- Group related tests in classes. Put shared setup and teardown in fixtures.
