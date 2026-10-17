---
type: regex
pattern: '^(?<![\s\S])(?=[\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:re-?run)\b(?![\s\S]*^[\s>*_#-]*decision[*_\s]*:[*_\s`]*(?:accept|reject|keep[- ]unconfirmed|re-?run)\b))(?=[\s\S]*(?:load average|\bloaded\b|machine load|\bload\b[^\n]{0,60}(flag|round|above|high|2\u00D7|2x|cpu|core)|(flag|round)[^\n]{0,60}\bload\b|busy|noisy machine))(?=[\s\S]*(?:noise|A/A|floor|margin|barely|just (above|over|past)))'
flags: im
match: contains
---
The reply's reason names the trap. Two of six rounds ran loaded, and the gain clears the noise floor by only a tenth, so the accept may rest on the loaded rounds.
