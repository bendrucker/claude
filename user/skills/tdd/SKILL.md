---
name: tdd
description: Test-driven development. Use when building a feature or fixing a bug test-first, when the user asks for red-green-refactor, or when a change needs its tests written before its implementation.
---

# Test-Driven Development

## Seams

A seam is where a module's interface lives: the place a caller observes behavior without reaching inside. Tests run at seams.

Before writing any test, ask the user what the public interface is and which seams to test. Write no test at an unconfirmed seam.

When the interface shape is itself in question, read [`LANGUAGE.md`](../improve-codebase-architecture/LANGUAGE.md) for the vocabulary: module, interface, implementation, depth, seam, adapter, locality.

## The Loop

One seam, one test, one minimal implementation per cycle.

1. Write one failing test at a confirmed seam. Run it and confirm it fails for the reason you expect.
2. Write only enough code to pass it. Anticipate no later test and add no speculative feature.
3. Return to step 1 with what the cycle taught.

Refactoring belongs to review, outside the loop: `review:code` for correctness, `simplify` for reuse and shape.

The work is done when every confirmed seam has a test that failed before its implementation existed.

## What a Good Test Is

Verify behavior through the interface. Name the test as a specification: "user can checkout with valid cart" names a capability. Use the domain language the surrounding code uses.

See [references/tests.md](references/tests.md) for good and bad pairs, and [references/mocking.md](references/mocking.md) for which seams get a substitute adapter.

## Anti-Patterns

#### Implementation-Coupled

The test substitutes an internal collaborator, exercises a private method, or verifies through a side channel such as querying the database instead of reading back through the interface. The tell: a refactor breaks the test while behavior is unchanged.

#### Tautological

The assertion recomputes the expected value the way the code computes it: `expect(add(a, b)).toBe(a + b)`, a snapshot worked out by hand through the same steps, a constant asserted equal to itself. Take expected values from an independent source: a known-good literal, a worked example, the spec.

#### Horizontal Slicing

Writing every test first, then every implementation. Work in vertical slices: one test, one implementation, repeat, each cycle responding to what the last one taught.

---

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/tdd/SKILL.md` at `6654f6b`, MIT.
