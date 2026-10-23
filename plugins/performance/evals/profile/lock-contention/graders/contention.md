---
type: regex
pattern: '^(?=[^\n]*(contend|contention|serializ|queu|mutex ?wait|psynch_mutexwait|waiting (on|for) (the |a )?(global )?(lock|mutex)|lock wait))(?=[^\n]*(stats_record|stats\.lock|stats lock|stats mutex|percentile_refresh|(shared|global|single|one) lock))'
flags: im
match: contains
---
Most worker time is threads waiting on the `stats.lock` mutex taken in `stats_record` (`__psynch_mutexwait`, about 74% of samples), so the reply names that lock as the contention.
