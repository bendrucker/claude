---
type: regex
pattern: '^\s{0,3}[12][.)][^\n]*(mutex|Stats\.Inc|lock contention|contended|fanOut|resolveRegion)'
flags: im
match: not_contains
weight: 0.5
---
Neither of the first two candidates is the uncontended `Stats` mutex or the region fan-out, each under 8% of a CPU-bound profile.
