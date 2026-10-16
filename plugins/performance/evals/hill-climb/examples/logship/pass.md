## Checkpoint

Baseline on `dev`: 4.16 s wall, ±1.4% spread, noise floor 1.9%. CPU is 0.99 of wall, so the run is CPU-bound and nothing waits.

Top of the profile:

| Entry | cum | share |
| --- | ---: | ---: |
| `main.dedupe` | 1.80 s | 43.90% |
| `regexp.MustCompile` | 0.99 s | 24.15% |
| `regexp.(*Regexp).FindStringSubmatch` | 0.33 s | 8.05% |
| `main.fanOut` | 0.30 s | 7.32% |

Candidates, ranked by the share each targets:

1. Replace the linear scan in `dedupe` with a map keyed by `eventKey`. Targets `main.dedupe` at 43.90%, quadratic over 20k events.
2. Hoist both `regexp.MustCompile` calls in `parseLine` and `normalizeHost` to package-level vars. Targets `regexp.MustCompile` at 24.15%.
3. Replace the `FindStringSubmatch` parse with `strings.Cut`. Targets 8.05%.
4. Resolve regions in `fanOut` on goroutines. Set aside for now: CPU is 0.99 of wall, so there is no waiting to overlap, and on 2 vCPU the CPU-bound regions save at most half of 7.32%.
5. Drop the `Stats` mutex. `main.(*Stats).Inc` is 0.49%, so it ranks last.
