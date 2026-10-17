---
type: regex
pattern: '^\s{0,3}(?:[12][.)]|\|\s*[*_`#]*[12][*_`]*\s*\|)(?![^\n]*(?:dedup|O\(n(²|\^2)\)|quadratic|MustCompile|regexp\.Compile|compil\w*[^\n]{0,60}reg(ular )?ex|reg(ular )?ex\w*[^\n]{0,60}(compil|hoist)|hoist\w*[^\n]{0,60}reg(ular )?ex))[^\n]*(mutex|Stats\.Inc|lock contention|contended|fanOut|resolveRegion)'
flags: im
match: not_contains
weight: 0.5
---
Neither of the first two candidates is the uncontended `Stats` mutex or the region fan-out, each under 8% of a CPU-bound profile.
