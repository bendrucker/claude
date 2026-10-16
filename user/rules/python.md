---
paths:
  - "**/*.py"
---

# Python

- Use the latest Python language features appropriate for the project's minimum supported version.

## Tooling

Load the `astral:uv`, `astral:ruff`, and `astral:ty` skills for detailed guidance on Python tooling.

## Documentation

`WebFetch` the official docs for a standard library module rather than answering from memory: `https://docs.python.org/3/library/<module>.html`.

## Type Hints

- Avoid `Any`. Use specific types, `TypeVar`, or protocols.
- Avoid `# type: ignore` outside rare cases in test code.
- Use `from __future__ import annotations` for forward references and cleaner type hints.

Example:
```python
from __future__ import annotations

def process_items(items: list[str], max_count: int | None = None) -> dict[str, int]:
    """Process items and return a count dictionary."""
    result: dict[str, int] = {}
    for item in items[:max_count]:
        result[item] = result.get(item, 0) + 1
    return result
```

## Tests

Use `pytest.mark.parametrize` for repeated cases.

- Use descriptive parameter names, and type test functions `-> None`.
- Group related tests in classes, and use fixtures for shared setup and teardown.
