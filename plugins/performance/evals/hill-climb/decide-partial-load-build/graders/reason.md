---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:load average|\bloaded\b|machine load|\bload\b[^\n]{0,60}(flag|round|above|high|2\u00D7|2x|cpu|core)|(flag|round)[^\n]{0,60}\bload\b|busy|noisy machine))'
flags: im
match: contains
---
The reply's reason names the trap. Control: one of six rounds ran loaded, and a gain this size at p = 0.001 cannot rest on three runs a side, so the flag doesn't block the accept.
