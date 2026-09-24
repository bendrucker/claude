---
fail: [short]
---
```ts
export function parseDuration(input: string, options: { allowNegative?: boolean } = {}): number
```

It accepts strings like `"1h30m"` or `"250ms"`, sums each number times its unit from `UNITS`, and returns milliseconds. Negative totals throw a `RangeError` unless `allowNegative` is set. `timer.ts` calls it through `timeout(spec)`, which wraps it in a `setTimeout` promise. Units are ms, s, m, and h only, so days and weeks are not supported, and an unrecognized unit is silently skipped rather than reported, which means `parseDuration("5d")` returns 0. `formatDuration` is the inverse, though it rounds differently, and a round trip is not guaranteed for mixed units like 90 minutes, which formats as `1.5h`.

Callers should validate input first, because the regex tolerates garbage between tokens, so "1h and 30m" parses the same as "1h30m", and that leniency is easy to depend on by accident once other modules start passing user-supplied strings through it.
