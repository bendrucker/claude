---
type: regex
pattern: '^(?=[\s\S]*(?:load average|\bloaded\b|machine load|\bload\b[^\n]{0,60}(flag|round|above|high|2\u00D7|2x|cpu|core)|(flag|round)[^\n]{0,60}\bload\b|busy|noisy machine))(?=[\s\S]*(?:noise|A/A|floor|margin|barely|just (above|over|past)))'
flags: i
match: contains
---
The reply's reason names the trap. Two of six rounds ran loaded, and the gain clears the noise floor by only a tenth, so the accept may rest on the loaded rounds.
