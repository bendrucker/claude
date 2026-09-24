`src/duration.ts:4`

```ts fragment
function parseDuration(
  input: string,
  options?: { allowNegative?: boolean }
): number
```

Parses strings like `"1h30m"` into milliseconds; throws `RangeError` on a negative total unless `allowNegative` is set.
