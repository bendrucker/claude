---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:reject|re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:fail|exit|error|crash|non-?zero))'
flags: im
match: contains
---
The reply's reason names the trap. The candidate arm has failed runs, which the report drops from its median, so the arm falls short of the Rules' run count. Rejecting, or re-running once the failures are explained, both hold the gain back.
