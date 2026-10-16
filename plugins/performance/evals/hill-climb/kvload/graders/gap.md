---
type: regex
pattern: '^(?=[^\n]*(?:wall|8\.6|duration|elapsed))(?=[^\n]*(?:cpu|user\s*\+\s*sys|samples|2\.0\d?\s*s|2\.1\d?\s*s))(?=[^\n]*(?:wait|block|idle|off.?cpu|not (on|using|burning) (the )?cpu|i/o|\bio\b|fsync|syscall|quarter|2[34](\.\d+)?\s?%|[34](\.\d)?\s?(x|×)|7[67](\.\d)?\s?%|gap|6\.[4-6]\d?\s?s|missing|unaccounted|(doesn''t|does not|can''t|cannot) (see|show|account|explain)))'
flags: im
match: contains
---
Wall time is 8.62s against 2.11s of user plus system CPU, and the profile samples 2.05s of an 8.62s run. About three quarters of the run is spent off the CPU, waiting on a per-record fsync.
