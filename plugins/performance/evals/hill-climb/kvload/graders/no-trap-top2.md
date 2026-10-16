---
type: regex
pattern: '^\s{0,3}[12][.)](?![^\n]*(?:fsync|\bsync\b|\.Sync|batch|group commit|durab|flush|off.?cpu|trace|wall.?clock|block|wait))[^\n]*(?:json|Marshal|Unmarshal|reflect|encod|decod|crc|checksum|normaliz|ToLower|ToUpper|malloc|alloc|\bGC\b|garbage)'
flags: im
match: not_contains
---
Neither of the first two candidates is a CPU micro-optimization the profile over-ranks: json, crc, normalize, alloc.
