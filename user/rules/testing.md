---
paths:
  - "**/*.test.*"
  - "**/*_test.*"
  - "**/*.spec.*"
  - "**/test_*.py"
---

# Testing

#### Repeated Cases

When two or more tests differ only in their data, collapse them into one table-driven test. Name every row so a failure identifies it.

#### Formatted Output

Assert formatted or structured output with one snapshot over the whole value.

#### Invariants

When a property holds across a range of inputs, write a property test over generated input. Look for roundtrip (`decode(encode(x))` equals `x`), idempotence, permutation invariance, partition (parts recombine to the whole), and agreement with a simpler oracle.

#### Fake Instances

Build filler instances of a domain type from a builder or generator defined beside the tests. Override only the fields the case cares about.

#### Refactors

Keep the same assertions and the same passing suite when refactoring a test. When a test is hard to write, reshape the interface under test before adding scaffolding to the test.

#### Ports

When a test moves to a new framework or follows code to a new implementation, keep every assertion at least as strong as the original: same expected values, same exit codes and stderr, same negative cases. Diff the old and new assertions before calling the conversion done, and list any assertion that was dropped, loosened to a substring or `toBeTruthy`, or turned into a snapshot of the new output.
