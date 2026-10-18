Candidates, ranked by the share each targets:

| # | Candidate | Targets |
| --- | --- | ---: |
| 1 | Replace the linear scan in `dedupe` with a map keyed by `eventKey` | `main.dedupe` 43.90% |
| 2 | Hoist both `regexp.MustCompile` calls to package-level vars | `regexp.MustCompile` 24.15% |
| 3 | Parse with `strings.Cut` instead of `FindStringSubmatch` | 8.05% |
| 4 | Drop the `Stats` mutex | 0.49% |

- Parallelizing `fanOut` is set aside: CPU is 0.99 of wall on 2 vCPU, so there is no waiting to overlap.
