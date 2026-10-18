1. Replace the linear scan in `dedupe` with a map. At 43.90% it is far bigger than the `Stats.Inc` mutex at 0.49%.
2. Hoist the `regexp.MustCompile` calls to package level. 24.15%.
3. Parse with `strings.Cut` instead of `FindStringSubmatch`. 8.05%.
4. Resolve regions in `fanOut` on goroutines, set aside: CPU is 0.99 of wall, so parallelism has no waiting to overlap.
