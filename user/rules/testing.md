---
paths:
  - "**/*.test.*"
  - "**/*_test.*"
  - "**/*.spec.*"
  - "**/test_*.py"
---

# Testing

## Technique Selection

#### Repeated Cases

When two or more tests differ only in their data, collapse them into one table-driven test. Give every row a name so a failure identifies the row without counting.

#### Formatted Output

Assert formatted or structured output with one snapshot over the whole value.

#### Invariants

When a property holds across a range of inputs, state it as a property test over generated input. Shapes to look for: roundtrip (`decode(encode(x))` equals `x`), idempotence, permutation invariance, partition (parts recombine to the whole), and agreement with a simpler oracle.

#### Fake Instances

Build filler instances of a domain type from a builder or generator defined beside the tests, overriding the fields the case cares about.

## Refactor Bar

A test refactor preserves behavior: the same assertions, fewer lines, and the same suite passing before and after.

When a test is hard to write, treat the difficulty as evidence about the interface and reshape it before adding scaffolding to the test.
