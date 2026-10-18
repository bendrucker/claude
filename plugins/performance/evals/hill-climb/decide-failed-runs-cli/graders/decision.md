---
type: regex
pattern: '^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject|re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b)'
flags: im
match: contains
---
The reply's last `Decision:` line is `reject` or `re-run`. The candidate arm has failed runs, which the report drops from its median, so the arm falls short of the Rules' run count. Rejecting, or re-running once the failures are explained, both hold the gain back.
